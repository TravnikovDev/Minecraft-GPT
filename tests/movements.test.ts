// Checks the walking rules: built blocks are never dug, natural ones may be,
// and wooden doors read as passable to the path search.
import { beforeEach, expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const Block = require(`${ROOT}/node_modules/prismarine-block`)(registry);
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
const { safeMovements, clearSolidDoors } = await import(`${ROOT}/src/core/movements.ts`);
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
