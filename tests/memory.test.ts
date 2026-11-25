// Phase 5: it remembers what matters and answers from memory, honestly.
// "Where did you die?", "where's the base?", "do we have iron?" come from
// memory with how old it is; a chest it never opened is "never looked
// inside", never "no iron"; a remembered table or chest that's gone is
// forgotten; "status" says what it's doing and what paused it.
import { EventEmitter } from "node:events";
import { beforeEach, expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");

const fake: any = Object.assign(new EventEmitter(), {
  registry,
  game: { dimension: "overworld" },
  entity: { position: new Vec3(0.5, 64, 0.5), metadata: [] },
  entities: {},
  players: { Travnikov: { username: "Travnikov", entity: { position: new Vec3(10.5, 64, 0.5) } } },
  health: 18,
  food: 15,
  foodSaturation: 3,
  time: { timeOfDay: 14000 },
  isRaining: true,
  thunderState: 0,
  stopDigging: () => {},
  clearControlStates: () => {},
  pathfinder: { goal: null, setGoal: () => {}, isMoving: () => false },
  blockAt: (p: any) => ({ name: "air", position: p }),
});
useFakeBot(fake);
const P = await import(`${ROOT}/src/managers/persistenceManager.ts`);
const S = await import(`${ROOT}/src/core/session.ts`);
const { whereIs } = await import(`${ROOT}/src/commands/WhereIs.ts`);
const { emit } = await import(`${ROOT}/src/core/events.ts`);
const { checkPlacesNearby, resetPlaceChecks } = await import(`${ROOT}/src/actions/placeCheck.ts`);
const A = await import(`${ROOT}/src/core/arbiter.ts`);
const R = await import(`${ROOT}/src/core/reflexes.ts`);
const L = await import(`${ROOT}/src/core/leases.ts`);
const { statusMessage } = await import(`${ROOT}/src/managers/chatGateway.ts`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  useFakeBot(fake);
  await P.updateMemory({ places: [], chests: [], lastDeath: undefined, bed: undefined, forbidden: [] });
  resetPlaceChecks();
  A.resetArbiter();
  L.resetLeases();
  R.resetReflexes();
});

test("'where did you die?' and 'where's your bed?' from memory, and honest when it doesn't know", async () => {
  await P.updateMemory({ deaths: [] });
  expect(whereIs("death", null)).toBe("I don't remember dying.");
  const at = Date.now() - 3 * 60_000;
  await S.saveDeath({ x: 605.4, y: 49, z: -1242.7, dimension: "overworld", at, itemCount: 30 });
  await S.logDeath({ x: 605.4, y: 49, z: -1242.7, dimension: "overworld", at });
  expect(whereIs("death", null)).toBe("I last died at 605, 49, -1243 (overworld), 3 min ago.");
  await S.saveDeath(null); // it went back for its things: the recovery record is cleared...
  expect(whereIs("death", null)).toBe("I last died at 605, 49, -1243 (overworld), 3 min ago."); // ...the answer isn't
  await S.saveBed({ x: 514, y: 79, z: -1140, dimension: "overworld", at: 1 });
  expect(whereIs("bed", null)).toBe("My bed is at 514, 79, -1140.");
});

test("places: the base and crafting tables, one or several", async () => {
  expect(whereIs("base", null)).toBe("I don't know where a base is.");
  await P.saveBaseLocation("home", { x: 10, y: 64, z: 10 });
  expect(whereIs("base", null)).toBe("The base is at 10, 64, 10.");
  await P.saveCraftingTableLocation({ x: 1, y: 64, z: 1 });
  await P.saveCraftingTableLocation({ x: 2, y: 64, z: 2 });
  expect(whereIs("crafting_table", null)).toBe("I know 2 crafting tables: 1, 64, 1; 2, 64, 2.");
});

test("'do we have iron?': from the chests it looked into; a chest never opened isn't 'no iron'", async () => {
  await S.rememberChest({ x: 5, y: 64, z: 5, dimension: "overworld", contents: { iron_ingot: 12 }, seenAt: Date.now() - 2 * 3_600_000 });
  await P.saveChestLocation({ x: 6, y: 64, z: 6 }); // placed, never opened
  expect(whereIs("item", "iron_ingot")).toBe("12 iron ingots in the chest at 5, 64, 5 (checked 2 h ago).");
  expect(whereIs("item", "diamond")).toBe("I don't know of any diamond in the chests I've looked in.");
  expect(whereIs("chests", null)).toBe("I know 2 chests: 5, 64, 5 (checked 2 h ago); 6, 64, 6 (never looked inside).");
});

test("a remembered table that was broken is forgotten as soon as it's seen to change", async () => {
  await P.saveCraftingTableLocation({ x: 3, y: 64, z: 0 });
  emit("block:changed", { position: new Vec3(3, 64, 0), from: "crafting_table", to: "air", selfCaused: false });
  await sleep(20);
  expect(P.getCraftingTables()).toEqual([]);
});

test("coming near a chest that's gone (after a restart), it forgets it; one not loaded is kept", async () => {
  await S.rememberChest({ x: 4, y: 64, z: 0, dimension: "overworld", contents: { coal: 3 }, seenAt: 1 });
  await S.rememberChest({ x: 8, y: 64, z: 0, dimension: "overworld", contents: { coal: 3 }, seenAt: 1 });
  fake.blockAt = (p: any) => (p.x === 8 ? null : { name: "grass_block", position: p }); // 8: not loaded
  await checkPlacesNearby();
  expect(S.loadChests().map((c: any) => c.x)).toEqual([8]);
  fake.blockAt = (p: any) => ({ name: "air", position: p });
});

test("status: what it's doing, what paused it, health and food, the sky, where the owner is", async () => {
  expect(statusMessage()).toBe("Idle. Health 18/20, food 15/20. Night, raining. You're 10 blocks away. I'm at 0, 64, 0.");
  A.propose({ name: "gatherWood", bucket: 2, run: () => sleep(100) });
  A.propose({ name: "craftItem", bucket: 2, run: async () => {} });
  await sleep(10);
  R.setReflexActive("creeper", true);
  expect(statusMessage()).toStartWith("Gather wood (paused: dealing with a creeper); next: craft item.");
  R.setReflexActive("creeper", false);
  await sleep(150);
});
