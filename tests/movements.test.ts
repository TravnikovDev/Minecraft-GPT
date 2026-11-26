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
