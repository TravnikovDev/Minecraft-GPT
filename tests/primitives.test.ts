// Phase 3: no action reports success unless the world shows it. The fake
// server here can refuse (put a block back, ignore a placement), never answer
// (a crafting window that never opens), or drop the connection, and every
// checked action must end with the right reason instead of hanging or lying.
import { EventEmitter } from "node:events";
import { beforeEach, expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const Block = require(`${ROOT}/node_modules/prismarine-block`)(registry);
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
const pf = require(`${ROOT}/node_modules/mineflayer-pathfinder`);

const key = (p: any) => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
let world = new Map<string, string>();
let loaded = (_p: any) => true;
function blockAt(p: any) {
  if (!loaded(p)) return null;
  const pos = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  const name = world.get(key(pos)) ?? (pos.y < 64 ? "stone" : "air");
  const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
  b.position = pos;
  return b;
}
type It = { name: string; count: number; type: number; stackSize: number };
const item = (name: string, count: number): It => ({ name, count, type: registry.itemsByName[name].id, stackSize: registry.itemsByName[name].stackSize });
let inv: It[] = [];
let server: { dig?: (b: any) => Promise<void>; place?: (ref: any, face: any) => Promise<void>; craft?: () => Promise<void>; goto?: (g: any) => Promise<void> } = {};
let closedWindows = 0;
let stoppedDigging = 0;
let pathStops = 0;

const fake: any = Object.assign(new EventEmitter(), {
  registry,
  version: "1.20.4",
  game: { gameMode: "survival" },
  entity: { position: new Vec3(0.5, 64, 0.5), height: 1.62, onGround: true },
  entities: {},
  vehicle: null,
  heldItem: null as It | null,
  inventory: { items: () => inv, emptySlotCount: () => 36 - inv.length, slots: [] as any[] },
  blockAt,
  canDigBlock: () => true,
  digTime: () => 50,
  player: { ping: 5 },
  lookAt: async () => {},
  stopDigging: () => stoppedDigging++,
  get currentWindow() {
    return { id: 1 };
  },
  closeWindow: () => closedWindows++,
  getEquipmentDestSlot: () => 5,
  equip: async (it: It) => {
    fake.heldItem = it;
  },
  dig: (b: any) => (server.dig ? server.dig(b) : Promise.resolve(world.set(key(b.position), "air")).then(() => {})),
  placeBlock: (ref: any, face: any) => (server.place ? server.place(ref, face) : Promise.resolve()),
  craft: (_recipe: unknown, count = 1) => (server.craft ? server.craft(count) : Promise.resolve()),
  pathfinder: {
    goal: null,
    isMoving: () => false,
    setGoal: (g: any) => {
      fake.pathfinder.goal = g;
      pathStops++;
    },
    goto: (g: any) => {
      fake.pathfinder.goal = g;
      return server.goto ? server.goto(g) : Promise.resolve();
    },
  },
});
useFakeBot(fake);
beforeEach(() => {
  useFakeBot(fake);
  world = new Map();
  loaded = () => true;
  inv = [];
  server = {};
  fake.heldItem = null;
  fake.entity.position = new Vec3(0.5, 64, 0.5);
  closedWindows = stoppedDigging = pathStops = 0;
  F.clearReverts();
  void updateMemory({ forbidden: [] });
});
const P = await import(`${ROOT}/src/core/primitives.ts`);
const { guarded } = await import(`${ROOT}/src/core/guard.ts`);
const { runWithSignal } = await import(`${ROOT}/src/core/commandContext.ts`);
const { depositInto } = await import(`${ROOT}/src/core/containers.ts`);
const F = await import(`${ROOT}/src/core/forbidden.ts`);
const { updateMemory } = await import(`${ROOT}/src/managers/persistenceManager.ts`);
const never = () => new Promise<never>(() => {});
// A stop after `ms`, like the owner's (an AbortController: Bun cancels an
// AbortSignal.timeout's timer once its last listener is removed)
function stopAfter(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort("Stopped by player"), ms);
  return c.signal;
}

// --- The guard: nothing hangs --------------------------------------------------------

test("a call that never answers times out and is stopped", async () => {
  let stopped = false;
  const r = await guarded("waiting", never, { timeoutMs: 50, onStop: () => (stopped = true) });
  expect(r).toMatchObject({ ok: false, reason: "timeout" });
  expect(stopped).toBe(true);
});

test("the owner's stop ends a call mid-way", async () => {
  const abort = new AbortController();
  setTimeout(() => abort.abort("Stopped by player"), 30);
  const r = await runWithSignal(abort.signal, () => guarded("waiting", never, { timeoutMs: 5000 }));
  expect(r).toMatchObject({ ok: false, reason: "aborted" });
});

test("a dropped connection ends a call mid-way", async () => {
  setTimeout(() => fake.emit("end"), 30);
  const r = await guarded("waiting", never, { timeoutMs: 5000 });
  expect(r).toMatchObject({ ok: false, reason: "disconnected" });
});

// --- Breaking -------------------------------------------------------------------------

test("breaking: success only once the block is gone", async () => {
  world.set("1,64,0", "dirt");
  const r = await P.breakBlock({ x: 1, y: 64, z: 0 });
  expect(r).toMatchObject({ ok: true, value: { name: "dirt", alreadyGone: false } });
});

test("breaking in a protected area: the server puts the block back, so it's 'reverted'", async () => {
  world.set("1,64,0", "dirt");
  // Like mineflayer: the dig ends by writing air locally; the server's answer
  // (the block put back) arrives a round trip later
  server.dig = async (b) => {
    world.set(key(b.position), "air");
    setTimeout(() => world.set(key(b.position), "dirt"), 100);
  };
  const r = await P.breakBlock({ x: 1, y: 64, z: 0 });
  expect(r).toMatchObject({ ok: false, reason: "reverted" });
});

test("breaking: unknown (not loaded), out of reach, and no tool are told apart", async () => {
  loaded = (p) => p.x < 50;
  expect(await P.breakBlock({ x: 60, y: 63, z: 0 })).toMatchObject({ ok: false, reason: "unknown_block" });
  expect(await P.breakBlock({ x: 20, y: 63, z: 0 })).toMatchObject({ ok: false, reason: "out_of_reach" });
  expect(await P.breakBlock({ x: 1, y: 63, z: 0 })).toMatchObject({ ok: false, reason: "no_tool" }); // stone, no pickaxe
});

test("a dig that never finishes times out and stops digging", async () => {
  world.set("1,64,0", "dirt");
  server.dig = never;
  const r = await runWithSignal(stopAfter(200), () => P.breakBlock({ x: 1, y: 64, z: 0 }));
  expect(r).toMatchObject({ ok: false, reason: "aborted" });
  expect(stoppedDigging).toBe(1);
});

// --- Placing --------------------------------------------------------------------------

test("placing: success only once the block is there", async () => {
  inv = [item("cobblestone", 5)];
  server.place = async (ref, face) => {
    world.set(key(ref.position.plus(face)), "cobblestone");
  };
  expect(await P.placeBlockAt("cobblestone", { x: 2, y: 64, z: 0 })).toMatchObject({ ok: true, value: { name: "cobblestone" } });
});

test("placing in a protected spot: nothing appears, so it's 'reverted'", async () => {
  inv = [item("cobblestone", 5)];
  server.place = async () => {
    throw new Error("No block has been placed : the block is still air");
  };
  expect(await P.placeBlockAt("cobblestone", { x: 2, y: 64, z: 0 })).toMatchObject({ ok: false, reason: "reverted" });
});

test("placing: a taken spot, nothing to place against, nothing to place, and where it stands", async () => {
  inv = [item("cobblestone", 5)];
  world.set("2,64,0", "dirt");
  expect(await P.placeBlockAt("cobblestone", { x: 2, y: 64, z: 0 })).toMatchObject({ ok: false, reason: "occupied" });
  expect(await P.placeBlockAt("cobblestone", { x: 2, y: 66, z: 0 })).toMatchObject({ ok: false, reason: "no_support" });
  expect(await P.placeBlockAt("torch", { x: 2, y: 64, z: 1 })).toMatchObject({ ok: false, reason: "missing_items" });
  expect(await P.placeBlockAt("cobblestone", { x: 0, y: 64, z: 0 })).toMatchObject({ ok: false, reason: "occupied" });
});

test("a torch counts as placed though it has no collision box", async () => {
  inv = [item("torch", 5)];
  server.place = async (ref, face) => {
    world.set(key(ref.position.plus(face)), "torch");
  };
  expect(await P.placeBlockAt("torch", { x: 2, y: 64, z: 0 })).toMatchObject({ ok: true });
});

// --- Crafting -------------------------------------------------------------------------

const stickRecipe = { result: { id: registry.itemsByName.stick.id, count: 4 }, inShape: null, ingredients: [] } as any;

test("crafting: the items must appear", async () => {
  // A stick recipe run gives 4: two runs (one per call) give 8
  server.craft = async (count = 1) => {
    inv.push(item("stick", 4 * count));
  };
  expect(await P.craftWith(stickRecipe, 2, null)).toMatchObject({ ok: true, value: 8 });
});

test("crafting at a table that never opens times out and closes the window", async () => {
  server.craft = never;
  const table = blockAt({ x: 1, y: 63, z: 0 });
  const r = await runWithSignal(stopAfter(200), () => P.craftWith(stickRecipe, 1, table));
  expect(r).toMatchObject({ ok: false, reason: "aborted" });
  expect(closedWindows).toBe(1);
});

test("crafting that the server ignores is refused, not reported as done", async () => {
  server.craft = async () => {};
  expect(await P.craftWith(stickRecipe, 1, null)).toMatchObject({ ok: false, reason: "refused" });
});

// --- Walking --------------------------------------------------------------------------

test("walking: no path is 'unreachable', and so is stopping short", async () => {
  server.goto = async () => {
    throw new Error("No path to the goal!");
  };
  expect(await P.goTo(new pf.goals.GoalNear(10, 64, 0, 1))).toMatchObject({ ok: false, reason: "unreachable" });
  server.goto = async () => {}; // "arrived", but it never moved
  expect(await P.goTo(new pf.goals.GoalNear(10, 64, 0, 1))).toMatchObject({ ok: false, reason: "unreachable" });
});

test("walking: arriving is checked, and a stop ends the walk", async () => {
  server.goto = async () => {
    fake.entity.position = new Vec3(10.5, 64, 0.5);
  };
  expect(await P.goTo(new pf.goals.GoalNear(10, 64, 0, 1))).toMatchObject({ ok: true });
  server.goto = never;
  const r = await runWithSignal(stopAfter(100), () => P.goTo(new pf.goals.GoalNear(20, 64, 0, 1)));
  expect(r).toMatchObject({ ok: false, reason: "aborted" });
  expect(pathStops).toBeGreaterThan(0);
});

// --- Chests ---------------------------------------------------------------------------

test("storing: a full chest is 'full', and a deposit is recounted", async () => {
  const stack = item("cobblestone", 64);
  inv = [stack];
  const full = { inventoryStart: 1, containerItems: () => [item("dirt", 64)], close() {}, deposit: async () => {}, withdraw: async () => {} };
  expect(await depositInto(full, stack as any, 64)).toMatchObject({ ok: false, reason: "full" });
  const ignoring = { inventoryStart: 27, containerItems: () => [], close() {}, deposit: async () => {}, withdraw: async () => {} };
  expect(await depositInto(ignoring, stack as any, 64)).toMatchObject({ ok: false, reason: "refused" }); // nothing left the inventory
  const working = {
    inventoryStart: 27,
    containerItems: () => [],
    close() {},
    deposit: async () => {
      inv = [];
    },
    withdraw: async () => {},
  };
  expect(await depositInto(working, stack as any, 64)).toMatchObject({ ok: true, value: 64 });
});

test("only the stop signal means 'stopped': a changed goal or a reset path is 'interrupted'", async () => {
  const { classifyError } = await import(`${ROOT}/src/core/result.ts`);
  const named = (name: string, message: string) => Object.assign(new Error(message), { name });
  expect(classifyError(named("GoalChanged", "The goal was changed before it could be completed!")).reason).toBe("interrupted");
  expect(classifyError(named("PathStopped", "Path was stopped before it could be completed!")).reason).toBe("interrupted");
  expect(classifyError(new Error("Digging aborted")).reason).toBe("interrupted");
  expect(classifyError(named("NoPath", "No path to the goal!")).reason).toBe("unreachable");
});

test("arriving while standing on farmland (or a slab) counts, as the pathfinder judges it", async () => {
  server.goto = async () => {
    fake.entity.position = new Vec3(10.5, 63.9375, 0.5); // feet inside the farmland block's space
  };
  expect(await P.goTo(new pf.goals.GoalBlock(10, 64, 0))).toMatchObject({ ok: true });
});

test("four blocks put back close together: a protected area it then keeps out of", async () => {
  for (let z = 0; z < 4; z++) world.set(`1,64,${z}`, "dirt");
  server.dig = async (b) => {}; // the server keeps every block
  // A few refusals are not a claim (falling sand, water, a placement it got wrong)
  for (let z = 0; z < 3; z++) {
    expect(await P.breakBlock({ x: 1, y: 64, z })).toMatchObject({ reason: "reverted" });
    expect(F.forbiddenAt({ x: 1, y: 64, z: 0 })).toBeNull();
  }
  expect(await P.breakBlock({ x: 1, y: 64, z: 3 })).toMatchObject({ reason: "reverted" });
  expect(F.forbiddenAt({ x: 1, y: 64, z: 0 })).toMatchObject({ source: "server" });
  inv = [item("cobblestone", 5)];
  expect(await P.placeBlockAt("cobblestone", { x: 2, y: 64, z: 0 })).toMatchObject({ ok: false, reason: "forbidden" });
});

test("the owner's keep-out area: no digging there; cleared, it's fine again", async () => {
  world.set("1,64,0", "dirt");
  await F.markForbidden({ x: 0, y: 64, z: 0 }, 5, "the owner said to keep out");
  expect(await P.breakBlock({ x: 1, y: 64, z: 0 })).toMatchObject({ ok: false, reason: "forbidden" });
  expect(await F.clearForbiddenAt({ x: 1, y: 64, z: 0 })).toBe(1);
  expect(await P.breakBlock({ x: 1, y: 64, z: 0 })).toMatchObject({ ok: true });
});

test("gravel falling into the gap isn't the server putting a block back", async () => {
  world.set("1,64,0", "gravel");
  server.dig = async () => {}; // more gravel falls in: the block looks the same
  expect(await P.breakBlock({ x: 1, y: 64, z: 0 })).toMatchObject({ ok: true });
  world.set("1,64,1", "gravel");
  expect(await P.breakBlock({ x: 1, y: 64, z: 1 })).toMatchObject({ ok: true });
  expect(F.forbiddenAt({ x: 1, y: 64, z: 0 })).toBeNull(); // no "protected area" in a gravel column
});

test("someone in a spot: a player or a mob counts, itself and a dropped item don't", () => {
  const spot = [{ x: 3, y: 64, z: 0 }];
  fake.entities = {
    1: fake.entity,
    2: { name: "item", position: new Vec3(3.5, 64, 0.5) },
  };
  expect(P.someoneIn(spot)).toBeNull();
  fake.entities[3] = { name: "player", username: "Travnikov", position: new Vec3(3.5, 64, 0.5), width: 0.6, height: 1.8 };
  expect(P.someoneIn(spot)).toBe("Travnikov");
  fake.entities[3] = { name: "zombie", position: new Vec3(5.5, 64, 0.5), width: 0.6, height: 1.95 };
  expect(P.someoneIn(spot)).toBeNull();
  fake.entities = {};
});
