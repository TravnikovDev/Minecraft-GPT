// Mining uses the diagonal tunnel (digDiagonalTunnel) to go down, its reverse
// (digDiagonalTunnelUp) to go up and out, and straight tunnels
// (digStraightTunnel) along a level. Runs the real functions in a fake stone
// world and checks exactly which blocks get dug.
import { beforeEach, expect, mock, setDefaultTimeout, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
// Each dig waits a moment for the server's answer (a protected area puts the
// block back), so a long tunnel takes several seconds
setDefaultTimeout(30_000);
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const Block = require(`${ROOT}/node_modules/prismarine-block`)(registry);
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);

// No real waiting, and no writing mine locations to the bot's database
const utility = await import(`${ROOT}/src/utils/utility.ts`);
mock.module(`${ROOT}/src/utils/utility.ts`, () => ({ ...utility, __actionsDelay: async () => {} }));
const persistence = await import(`${ROOT}/src/managers/persistenceManager.ts`);
mock.module(`${ROOT}/src/managers/persistenceManager.ts`, () => ({ ...persistence, saveMineLocation: () => {} }));

// The bot's inventory, and crafting as the game does it: 1 coal (or charcoal) + 1 stick = 4 torches
let items: { name: string; count: number }[] = [];
const take = (name: string, n: number) => {
  const it = items.find((i) => i.name === name);
  if (it) it.count -= n;
  items = items.filter((i) => i.count > 0);
};
const crafting = await import(`${ROOT}/src/actions/crafting.ts`);
mock.module(`${ROOT}/src/actions/crafting.ts`, () => ({
  ...crafting,
  craftRecipe: async (name: string, n: number) => {
    if (name !== "torch") return false;
    const crafts = Math.ceil(n / 4);
    const fuel = items.find((i) => i.name === "coal" || i.name === "charcoal");
    if (!fuel || fuel.count < crafts || (items.find((i) => i.name === "stick")?.count ?? 0) < crafts) return false;
    take(fuel.name, crafts);
    take("stick", crafts);
    items.push({ name: "torch", count: crafts * 4 });
    return true;
  },
}));

const SURFACE = 64; // stone below, air from here up
const changed = new Map<string, string>();
const key = (p: any) => `${p.x},${p.y},${p.z}`;
const dug: string[] = [];
const torches: { at: string; wall: string }[] = [];
const placed: string[] = [];
const said: string[] = [];
function blockAt(p: any) {
  const pos = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  const name = changed.get(key(pos)) ?? (pos.y < SURFACE ? "stone" : "air");
  const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
  b.position = pos;
  return b;
}
const fake: any = {
  registry,
  version: "1.20.4",
  game: { gameMode: "creative", minY: -64, height: 384 },
  entity: { position: new Vec3(0.5, 60, 0.5), yaw: 0 },
  entities: {},
  vehicle: null,
  heldItem: null,
  inventory: { items: () => items, emptySlotCount: () => 30 },
  blockAt,
  world: { getBlock: blockAt, raycast: () => null },
  canDigBlock: () => true,
  digTime: () => 50,
  player: { ping: 5 },
  lookAt: async () => {},
  chat: (m: string) => said.push(m),
  equip: async (item: any) => {
    fake.heldItem = item; // in hand, as the server confirms
  },
  placeBlock: async (wall: any, face: any) => {
    const at = wall.position.plus(face);
    const held = fake.heldItem?.name ?? "torch";
    if (held === "torch") {
      torches.push({ at: key(at), wall: key(wall.position) });
      changed.set(key(at), "wall_torch");
    } else {
      placed.push(key(at));
      changed.set(key(at), held);
    }
    take(held, 1);
  },
  on: () => {},
  off: () => {},
  dig: async (b: any) => {
    dug.push(key(b.position));
    changed.set(key(b.position), "air");
  },
  pathfinder: {
    goal: null,
    movements: {},
    isMoving: () => false,
    setGoal: () => {},
    goto: async (g: any) => {
      fake.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5);
    },
  },
};
const teleport = fake.pathfinder.goto;
useFakeBot(fake);
beforeEach(() => {
  fake.pathfinder.goto = teleport;
  useFakeBot(fake);
  changed.clear();
  dug.length = 0;
  torches.length = 0;
  placed.length = 0;
  said.length = 0;
  items = [];
});
const digging = await import(`${ROOT}/src/actions/digging.ts`);

const column = (x: number, y: number, z: number, height: number) => Array.from({ length: height + 1 }, (_, h) => key({ x, y: y + h, z }));

test("going down to a buried ore: one diagonal tunnel, then a straight one along its level", async () => {
  fake.entity.position = new Vec3(0.5, 60, 0.5);
  expect(await digging.tunnelTo(new Vec3(6, 54, 3), "iron ore")).toBe(true);
  // Diagonal: one forward (east), one down per step, 4 blocks tall at each step
  const diagonal = [0, 1, 2, 3, 4, 5, 6].flatMap((i) => column(i, 60 - i, 0, 3));
  // Straight: south along y=54, 2 high, stopping next to the ore at z=3
  const straight = [1, 2].flatMap((z) => column(6, 54, z, 1));
  expect(new Set(dug)).toEqual(new Set([...diagonal, ...straight].filter((k) => Number(k.split(",")[1]) < SURFACE)));
  expect(dug).not.toContain(key({ x: 6, y: 54, z: 3 })); // the ore itself is left for mining
  expect(fake.entity.position.floored()).toEqual(new Vec3(6, 54, 2));
});

test("no shaft: every dug block lies on the diagonal or the level tunnel", async () => {
  fake.entity.position = new Vec3(0.5, 60, 0.5);
  await digging.tunnelTo(new Vec3(0, 52, 0), "diamond ore"); // straight below
  for (const k of dug) {
    const [x, y] = k.split(",").map(Number);
    if (y >= 52 + 4) expect(y - (60 - x)).toBeGreaterThanOrEqual(0); // on the diagonal's slope
  }
  expect(dug.filter((k) => k.startsWith("0,") && Number(k.split(",")[1]) < 60).length).toBe(0); // nothing dug under the start
});

test("the reverse tunnel goes up one forward, one up per step, keeping each stair", async () => {
  fake.entity.position = new Vec3(0.5, 50, 0.5);
  expect(await digging.digDiagonalTunnelUp("north", 3, { width: 1, height: 3 })).toBe(true);
  expect(new Set(dug)).toEqual(new Set([0, 1, 2, 3].flatMap((i) => column(0, 50 + i, -i, 3))));
  for (const i of [1, 2, 3]) expect(blockAt({ x: 0, y: 49 + i, z: -i }).name).toBe("stone"); // the stairs
});

test("dig out to the surface stops once the sky is open above", async () => {
  fake.entity.position = new Vec3(0.5, 56, 0.5);
  fake.entity.yaw = 0; // facing north
  expect(await digging.digOutToSurface()).toBe(true);
  const here = fake.entity.position.floored();
  expect(here.y).toBeGreaterThanOrEqual(SURFACE - 1); // at ground level, or one step below it
  expect(digging.isOutside(here, "north")).toBe(true); // and can walk out
  expect(here.x).toBe(0);
  expect(here.z).toBe(56 - here.y); // straight north-and-up, one by one
});

test("a tunnel never breaks something built, and stops at lava", async () => {
  fake.entity.position = new Vec3(0.5, 60, 0.5);
  changed.set(key({ x: 2, y: 59, z: 0 }), "oak_planks"); // someone's underground room
  expect(await digging.tunnelTo(new Vec3(6, 54, 0), "iron ore")).toBe(false);
  expect(dug).not.toContain(key({ x: 2, y: 59, z: 0 }));

  changed.clear();
  dug.length = 0;
  fake.entity.position = new Vec3(0.5, 60, 0.5);
  changed.set(key({ x: 3, y: 57, z: 1 }), "lava"); // right beside the 3rd step
  expect(await digging.tunnelTo(new Vec3(6, 54, 0), "iron ore")).toBe(false);
  expect(dug).not.toContain(key({ x: 3, y: 57, z: 0 }));
});

test("a torch every 7 blocks along the whole route, on a side wall", async () => {
  items = [{ name: "torch", count: 64 }];
  fake.entity.position = new Vec3(0.5, 60, 0.5);
  // 15 diagonal steps (east, down to y=46), then 6 straight steps south
  expect(await digging.tunnelTo(new Vec3(14, 46, 7), "diamond ore")).toBe(true);
  expect(torches.map((t) => t.at)).toEqual([key({ x: 6, y: 56, z: 0 }), key({ x: 13, y: 49, z: 0 }), key({ x: 14, y: 47, z: 6 })]);
  // Diagonal part goes east: its torches hang on the north wall. Straight part goes south: on the west wall.
  expect(torches.map((t) => t.wall)).toEqual([key({ x: 6, y: 56, z: -1 }), key({ x: 13, y: 49, z: -1 }), key({ x: 13, y: 47, z: 6 })]);
});

test("with no torches it crafts them from the coal and sticks it carries", async () => {
  items = [{ name: "coal", count: 2 }, { name: "stick", count: 3 }];
  fake.entity.position = new Vec3(0.5, 60, 0.5);
  expect(await digging.tunnelTo(new Vec3(8, 52, 0), "iron ore")).toBe(true);
  expect(torches.length).toBe(1);
  expect(items.find((i) => i.name === "torch")?.count).toBe(7); // crafted 8, placed 1
});

test("with no torches and no coal it says so once and keeps digging", async () => {
  fake.entity.position = new Vec3(0.5, 60, 0.5);
  expect(await digging.tunnelTo(new Vec3(16, 44, 0), "iron ore")).toBe(true);
  expect(torches.length).toBe(0);
  expect(said.filter((m) => m.includes("no torches")).length).toBeLessThanOrEqual(1);
});

// A cave under the stairs: x 2..6, y 50..59, z -1..1 all air. Walking
// (within reach of a block) stands on a stair already dug, as the real
// pathfinder would, not inside the block it's going to place.
function carveCave(): void {
  for (let x = 2; x <= 6; x++) for (let y = 50; y <= 59; y++) for (let z = -1; z <= 1; z++) changed.set(key({ x, y, z }), "air");
  walkOnStairs();
}

/** Walking stands on a stair already dug (as the pathfinder would), not in the block it's after. */
function walkOnStairs(): void {
  fake.pathfinder.goto = async (g: any) => {
    for (let i = 0; i <= 6; i++) {
      const stair = new Vec3(i, 60 - i, 0);
      if (g.isEnd(stair) && blockAt(stair).boundingBox === "empty") {
        fake.entity.position = new Vec3(i + 0.5, 60 - i, 0.5);
        return;
      }
    }
    fake.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5);
  };
}

test("stairs over a cave: each floor gets built, a support block first where nothing is next to it", async () => {
  carveCave();
  items = [{ name: "dirt", count: 64 }];
  fake.entity.position = new Vec3(0.5, 60, 0.5);
  expect(await digging.digDiagonalTunnel("east", 5, { width: 1, height: 3 }, new Vec3(0, 60, 0), "test", 99, { save: false })).toBe(true);
  for (let i = 0; i <= 5; i++) expect(blockAt({ x: i, y: 59 - i, z: 0 }).boundingBox).toBe("block"); // every stair has a floor
  // No block was put in the stairs' walking space
  for (const k of placed) {
    const [x, y, z] = k.split(",").map(Number);
    expect(digging.inStaircase(new Vec3(x, y, z), new Vec3(0, 60, 0), "east", 1, 3)).toBe(false);
  }
  expect(placed.length).toBeGreaterThan(4); // floors plus supports
});

test("stairs over a cave with nothing to build with: the tunnel stops at the drop", async () => {
  carveCave();
  items = [];
  fake.entity.position = new Vec3(0.5, 60, 0.5);
  expect(await digging.digDiagonalTunnel("east", 5, { width: 1, height: 3 }, new Vec3(0, 60, 0), "test", 99, { save: false })).toBe(false);
  expect(dug).not.toContain(key({ x: 4, y: 59, z: 0 })); // never went on past the first floorless step
});

test("a support block goes next to the last solid one, never in the walking space", () => {
  const solidAt = new Set([key({ x: 2, y: 57, z: 0 })]); // the previous stair's floor
  const at = (p: any) => (solidAt.has(key(p)) ? { name: "dirt", boundingBox: "block" } : { name: "air", boundingBox: "empty" });
  const clear = (p: any) => digging.inStaircase(p, new Vec3(0, 60, 0), "east", 1, 3);
  expect(digging.supportFor(new Vec3(3, 56, 0), at, clear)).toEqual(new Vec3(2, 56, 0)); // under the previous floor
  // Leaves next to it are no support
  const leafy = (p: any) => (key(p) === key({ x: 2, y: 56, z: 0 }) ? { name: "oak_leaves", boundingBox: "block" } : at(p));
  expect(digging.supportFor(new Vec3(3, 56, 0), leafy, clear)).toEqual(new Vec3(2, 56, 0));
});

test("a floor two blocks from anything solid (over water): a short bridge of supports, solid end first", () => {
  // Only the previous step's floor is solid; the next floor is two cells out from it
  const solidAt = new Set([key({ x: 2, y: 57, z: 0 })]);
  const at = (p: any) => (solidAt.has(key(p)) ? { name: "stone", boundingBox: "block" } : { name: "water", boundingBox: "empty" });
  const clear = (p: any) => digging.inStaircase(p, new Vec3(0, 60, 0), "east", 1, 3);
  const chain = digging.supportChain(new Vec3(4, 56, 0), at, clear);
  expect(chain).not.toBeNull();
  expect(chain.length).toBe(2);
  // The first one is beside the solid block, the last beside the hole
  const touches = (a: any, b: any) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) === 1;
  expect(touches(chain[0], { x: 2, y: 57, z: 0 })).toBe(true);
  expect(touches(chain[1], { x: 4, y: 56, z: 0 })).toBe(true);
  for (const c of chain) expect(clear(c)).toBe(false);
  // Too far: nothing
  expect(digging.supportChain(new Vec3(9, 50, 0), at, clear)).toBeNull();
});

test("water next to the tunnel: it plugs it with dirt and digs on", async () => {
  changed.set(key({ x: 3, y: 57, z: 1 }), "water"); // beside the 3rd step
  walkOnStairs();
  items = [{ name: "dirt", count: 16 }];
  fake.entity.position = new Vec3(0.5, 60, 0.5);
  expect(await digging.digDiagonalTunnel("east", 5, { width: 1, height: 3 }, new Vec3(0, 60, 0), "test", 99, { save: false })).toBe(true);
  expect(blockAt({ x: 3, y: 57, z: 1 }).name).toBe("dirt");
});

test("water next to the tunnel and nothing to plug it with: it stops", async () => {
  changed.set(key({ x: 3, y: 57, z: 1 }), "water");
  items = [];
  fake.entity.position = new Vec3(0.5, 60, 0.5);
  expect(await digging.digDiagonalTunnel("east", 5, { width: 1, height: 3 }, new Vec3(0, 60, 0), "test", 99, { save: false })).toBe(false);
});
