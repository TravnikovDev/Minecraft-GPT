// Checks the walking rules: built blocks are never dug, natural ones may be,
// and wooden doors read as passable to the path search.
import { beforeEach, expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const Block = require(`${ROOT}/node_modules/prismarine-block`)(registry);
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
const { safeMovements, clearSolidDoors, avoidStep, protectCells, isProtected, setOwnPassages, nearOwnPassage } = await import(`${ROOT}/src/core/movements.ts`);
beforeEach(() => clearSolidDoors());

const world = new Map<string, any>();
const bot: any = {
  registry,
  version: "1.20.4",
  supportFeature: () => false,
  blockAt: (p: any) => world.get(`${p.x},${p.y},${p.z}`) ?? Block.fromStateId(registry.blocksByName.air.defaultState, 0),
  world: { getBlock: (p: any) => bot.blockAt(p) },
};
const moves = safeMovements(bot);
const id = (n: string) => registry.blocksByName[n].id;

test("built blocks are never dug while walking", () => {
  for (const n of ["oak_planks", "cobblestone", "glass", "bricks", "stone_bricks", "dragon_egg", "white_bed", "chest", "oak_door", "oak_log", "white_wool", "glass_pane"]) {
    expect(moves.blocksCantBreak.has(id(n))).toBe(true);
  }
});

test("natural terrain may be dug", () => {
  for (const n of ["dirt", "grass_block", "stone", "deepslate", "sand", "gravel", "oak_leaves", "iron_ore", "netherrack", "white_terracotta"]) {
    expect(moves.blocksCantBreak.has(id(n))).toBe(false);
  }
  expect(moves.blocksCantBreak.has(id("white_glazed_terracotta"))).toBe(true);
});

test("a closed wooden door reads as passable, an iron door does not", () => {
  const door = Block.fromStateId(registry.blocksByName.oak_door.defaultState, 0);
  door.position = new Vec3(0, 64, 0);
  world.set("0,64,0", door);
  const b = moves.getBlock(new Vec3(0, 64, 0), 0, 0, 0);
  expect(b.safe).toBe(true);
  expect(b.physical).toBe(false);

  const iron = Block.fromStateId(registry.blocksByName.iron_door.defaultState, 0);
  iron.position = new Vec3(1, 64, 0);
  world.set("1,64,0", iron);
  const i = moves.getBlock(new Vec3(1, 64, 0), 0, 0, 0);
  expect(i.safe).toBe(false);
});

test("doors are doorways to the path (walked through at the middle), but the pathfinder never clicks them", () => {
  expect(moves.openable.has(id("oak_door"))).toBe(true);
  expect(moves.openable.has(id("spruce_door"))).toBe(true);
  expect(moves.openable.has(id("iron_door"))).toBe(false);
  expect(moves.openable.has(id("oak_fence_gate"))).toBe(true); // gates still opened by the pathfinder
  const b = moves.getBlock(new Vec3(0, 64, 0), 0, 0, 0); // the oak door placed above
  expect(b.openable).toBe(false);
});

test("a step a walk got stuck on is routed around for a while", () => {
  const ledge = { position: new Vec3(48, 95, 31) };
  expect(moves.exclusionStep(ledge)).toBe(0);
  avoidStep({ x: 48.4, y: 95, z: 31.2 }); // the stall log's "next" step
  expect(moves.exclusionStep(ledge)).toBeGreaterThan(0); // dearer, not banned:
  expect(moves.exclusionStep(ledge)).toBeLessThan(100); // the pathfinder drops moves over 100
  expect(moves.exclusionStep({ position: new Vec3(48, 95, 30) })).toBe(0); // only that cell
});

test("its shelter's walls are never dug through by a walk", () => {
  const wall = { position: new Vec3(2, 63, 7) };
  expect(moves.exclusionBreak(wall)).toBe(0);
  protectCells([{ x: 2, y: 63, z: 7 }]);
  expect(isProtected({ x: 2.4, y: 63, z: 7.9 })).toBe(true);
  expect(moves.exclusionBreak(wall)).toBeGreaterThanOrEqual(10_000);
  protectCells([]);
  expect(moves.exclusionBreak(wall)).toBe(0);
});

test("its own walks may dig out of its field (a crater there trapped it); collecting still keeps off it", () => {
  const ground = { position: new Vec3(-2, 73, -7) };
  protectCells([{ x: -2, y: 73, z: -7 }], "farm");
  expect(isProtected({ x: -2, y: 73, z: -7 })).toBe(true);
  expect(moves.exclusionBreak(ground)).toBe(0);
  protectCells([], "farm");
});

test("a stall inside its own shelter is never held against the stairs", () => {
  setOwnPassages([{ x: 0, y: 66, z: 3 }]);
  avoidStep({ x: 0, y: 66, z: 3 });
  expect(moves.exclusionStep({ position: new Vec3(0, 66, 3) })).toBe(0);
  setOwnPassages([]);
});

test("nothing it places goes in or right next to its shelter's stairs and doorways (owner: the exit is untouchable)", () => {
  setOwnPassages([{ x: 0, y: 76, z: -23 }, { x: 1, y: 77, z: -23 }]);
  expect(nearOwnPassage({ x: 0, y: 76, z: -23 })).toBe(true); // the first step (the furnace went there)
  expect(nearOwnPassage({ x: 2, y: 77, z: -23 })).toBe(true); // right in front of the way in
  expect(nearOwnPassage({ x: 4, y: 77, z: -23 })).toBe(false);
  setOwnPassages([]);
});

test("ordinary errands walk; a fight or the way home at dusk sprints (owner: sprinting burns food)", async () => {
  const { walkingRules, setHurry } = await import(`${ROOT}/src/core/movements.ts`);
  const rules = walkingRules(bot);
  expect(rules.allowSprinting).toBe(false);
  setHurry(bot, "fight", true);
  expect(rules.allowSprinting).toBe(true);
  setHurry(bot, "dusk", true);
  setHurry(bot, "fight", false);
  expect(rules.allowSprinting).toBe(true); // still home at dusk
  setHurry(bot, "dusk", false);
  expect(rules.allowSprinting).toBe(false);
});

test("from dry land a walk never goes under water; in the water it may swim out (owner: it drowned on its way again and again)", () => {
  const water = Block.fromStateId(registry.blocksByName.water.defaultState, 0);
  for (const y of [60, 61]) world.set(`5,${y},5`, water);
  const step = { position: new Vec3(5, 60, 5) };
  bot.entity = { position: new Vec3(0, 64, 0) }; // on dry land
  expect(moves.exclusionStep(step)).toBeGreaterThan(100); // the pathfinder drops it
  world.set(`0,64,0`, water);
  world.set(`0,65,0`, water);
  expect(moves.exclusionStep(step)).toBeLessThan(100); // under water itself: it can swim out
  for (const k of ["5,60,5", "5,61,5", "0,64,0", "0,65,0"]) world.delete(k);
  delete bot.entity;
});

test("walled in, its walks break through its own cobblestone by its passages, never its shell or with water behind (game test: three hours shut in its mine)", async () => {
  const { setWalledIn } = await import(`${ROOT}/src/core/movements.ts`);
  const at = (n: string, x: number, y: number, z: number) => {
    const b = Block.fromStateId(registry.blocksByName[n].defaultState, 0);
    b.position = new Vec3(x, y, z);
    world.set(`${x},${y},${z}`, b);
    return b;
  };
  setOwnPassages([{ x: -54, y: 49, z: 2 }], "mine");
  const seal = at("cobblestone", -55, 49, 2);
  const far = at("cobblestone", -60, 49, 2);
  expect(moves.safeToBreak(seal)).toBe(false); // ordinarily: built, never broken
  setWalledIn(60_000);
  expect(moves.safeToBreak(seal)).toBe(true);
  expect(moves.safeToBreak(far)).toBe(false); // nowhere near its passages
  protectCells([{ x: -55, y: 49, z: 2 }], "mine");
  expect(moves.safeToBreak(seal)).toBe(false); // its mine's shell
  protectCells([], "mine");
  at("water", -55, 50, 2);
  expect(moves.safeToBreak(seal)).toBe(false); // water would come in
  setWalledIn(0);
  setOwnPassages([], "mine");
  for (const k of ["-55,49,2", "-60,49,2", "-55,50,2"]) world.delete(k);
});

test("no walk cuts its mine's walls, floors or ceilings; only the tunnel digger cuts the mine (owner: a mess on the 2nd floor)", async () => {
  const { setWalledIn } = await import(`${ROOT}/src/core/movements.ts`);
  // A pokehole: 1 wide, 3 high, along z
  const cells: any[] = [];
  for (let z = 1; z <= 5; z++) for (let y = 38; y <= 40; y++) cells.push({ x: -76, y, z });
  setOwnPassages(cells, "mine");
  const at = (name: string, x: number, y: number, z: number) => {
    const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
    b.position = new Vec3(x, y, z);
    return b;
  };
  expect(moves.exclusionBreak(at("stone", -75, 39, 3))).toBeGreaterThanOrEqual(10_000); // a side wall
  expect(moves.exclusionBreak(at("stone", -76, 41, 3))).toBeGreaterThanOrEqual(10_000); // the ceiling
  expect(moves.exclusionBreak(at("stone", -76, 37, 3))).toBeGreaterThanOrEqual(10_000); // the floor
  expect(moves.exclusionBreak(at("stone", -76, 39, 3))).toBe(0); // its own cell (a block fallen in)
  expect(moves.exclusionBreak(at("stone", -73, 39, 3))).toBe(0); // rock away from the mine
  // Walled in: its mine's walls may go, its own cobblestone and the stone
  // (game test: stuck on its own bridge in a cave crossing its mine's plan,
  // every block round it walled a tunnel and it had no move at all)
  setWalledIn(60_000);
  expect(moves.exclusionBreak(at("cobblestone", -75, 39, 3))).toBe(0);
  expect(moves.exclusionBreak(at("stone", -75, 39, 3))).toBe(0);
  setWalledIn(0);
  // Gathering ore it saw: its walks may cut through to it (owner)
  const { whileGathering } = await import(`${ROOT}/src/core/movements.ts`);
  await whileGathering(async () => {
    expect(moves.exclusionBreak(at("stone", -75, 39, 3))).toBe(0);
  });
  expect(moves.exclusionBreak(at("stone", -75, 39, 3))).toBeGreaterThanOrEqual(10_000);
  setOwnPassages([], "mine");
});
