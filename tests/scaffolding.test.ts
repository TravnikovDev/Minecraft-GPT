// The bot takes down the pillars and bridges it built to get somewhere, and
// only those: the walking rules let it dig its own scaffolding (even straight
// down its own pillar), never cobblestone anyone else placed.
import { beforeEach, expect, mock, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const Block = require(`${ROOT}/node_modules/prismarine-block`)(registry);
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
const pf = require(`${ROOT}/node_modules/mineflayer-pathfinder`);
const AStar = require(`${ROOT}/node_modules/mineflayer-pathfinder/lib/astar.js`);
const Move = require(`${ROOT}/node_modules/mineflayer-pathfinder/lib/move.js`);

const utility = await import(`${ROOT}/src/utils/utility.ts`);
mock.module(`${ROOT}/src/utils/utility.ts`, () => ({ ...utility, __actionsDelay: async () => {} }));

// Grass up to y=63, a 6-block cobblestone pillar at 0,64..69,0 with the bot on top
const changed = new Map<string, string>();
const key = (p: any) => `${p.x},${p.y},${p.z}`;
const dug: string[] = [];
function blockAt(p: any) {
  const pos = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  const name = changed.get(key(pos)) ?? (pos.y < 64 ? "grass_block" : "air");
  const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
  b.position = pos;
  return b;
}
const fake: any = {
  registry,
  version: "1.20.4",
  supportFeature: () => false,
  game: { gameMode: "creative", minY: -64 },
  entity: { position: new Vec3(0.5, 70, 0.5), onGround: true, effects: {} },
  entities: {},
  vehicle: null,
  heldItem: null,
  inventory: { items: () => [], emptySlotCount: () => 30 },
  blockAt,
  world: { getBlock: blockAt, raycast: () => null },
  canDigBlock: () => true,
  digTime: () => 50,
  player: { ping: 5 },
  lookAt: async () => {},
  chat: () => {},
  dig: async (b: any) => {
    dug.push(key(b.position));
    changed.set(key(b.position), "air");
    const { forgetScaffold } = await import(`${ROOT}/src/core/scaffold.ts`);
    forgetScaffold(b.position);
    // Standing on it: drop onto the next block down
    const feet = fake.entity.position.floored();
    if (b.position.x === feet.x && b.position.z === feet.z && b.position.y === feet.y - 1) fake.entity.position = fake.entity.position.offset(0, -1, 0);
  },
  pathfinder: { goal: null, movements: {}, isMoving: () => false, setGoal: () => {}, goto: async () => {}, bestHarvestTool: () => ({ type: registry.itemsByName.iron_pickaxe.id, nbt: null }) },
};
useFakeBot(fake);
const scaffold = await import(`${ROOT}/src/core/scaffold.ts`);
beforeEach(() => {
  useFakeBot(fake);
  changed.clear();
  dug.length = 0;
  scaffold.clearScaffolds();
  for (let y = 64; y <= 69; y++) changed.set(key({ x: 0, y, z: 0 }), "cobblestone");
  fake.entity.position = new Vec3(0.5, 70, 0.5);
});
const { safeMovements } = await import(`${ROOT}/src/core/movements.ts`);
const { takeDownScaffolding } = await import(`${ROOT}/src/actions/scaffolding.ts`);
const pillar = () => [64, 65, 66, 67, 68, 69].map((y) => key({ x: 0, y, z: 0 }));

/** The path down from the top of the pillar (6 high: too far to jump off). */
function planDown() {
  const moves = safeMovements(fake);
  moves.allow1by1towers = false;
  moves.allowParkour = false;
  return new AStar(new Move(0, 70, 0, 0, 0), moves, new pf.goals.GoalY(64), 2000, 2000).compute();
}

test("on its own pillar, the path down digs through the pillar", () => {
  for (let y = 64; y <= 69; y++) scaffold.recordScaffold({ x: 0, y, z: 0 });
  const result = planDown();
  expect(result.status).toBe("success");
  const broken = result.path.flatMap((m: any) => m.toBreak.map(key));
  expect(broken.every((k: string) => pillar().includes(k))).toBe(true);
});

test("someone else's cobblestone pillar is never dug through", () => {
  const result = planDown();
  const broken = result.path.flatMap((m: any) => m.toBreak.map(key));
  expect(broken).toEqual([]);
});

test("after the tree it climbs down its pillar, removing it block by block, nothing else", async () => {
  for (let y = 64; y <= 69; y++) scaffold.recordScaffold({ x: 0, y, z: 0 });
  changed.set(key({ x: 2, y: 64, z: 0 }), "cobblestone"); // the owner's block nearby: not ours
  const removed = await takeDownScaffolding();
  expect(removed).toBe(6);
  expect(new Set(dug)).toEqual(new Set(pillar()));
  expect(fake.entity.position.floored().y).toBe(64);
  expect(scaffold.ownScaffolds()).toEqual([]);
});

// Owner (2026-11-28): it built scaffolding to take scaffolding down, then took
// the new blocks down first, in a loop. A pillar too tall to reach from the
// ground is climbed beside and taken down on the way back.
const pillarCells = (x: number, z: number, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ x, y: from + i, z }));

test("a pillar's cells, highest first; other columns left out", async () => {
  const { columnOf } = await import(`${ROOT}/src/actions/scaffolding.ts`);
  const cells = [...pillarCells(0, 0, 64, 70), ...pillarCells(1, 0, 64, 65)];
  const col = columnOf(cells, 0, 0);
  expect(col.length).toBe(7);
  expect(col[0].y).toBe(70);
  expect(col[6].y).toBe(64);
});

test("a pillar 4 or more over its foot is out of reach from the ground; a short one isn't", async () => {
  const { tooTallFromGround } = await import(`${ROOT}/src/actions/scaffolding.ts`);
  expect(tooTallFromGround(pillarCells(0, 0, 64, 70))).toBe(true);
  expect(tooTallFromGround(pillarCells(0, 0, 64, 68))).toBe(true);
  expect(tooTallFromGround(pillarCells(0, 0, 64, 67))).toBe(false);
  expect(tooTallFromGround([])).toBe(false);
});
