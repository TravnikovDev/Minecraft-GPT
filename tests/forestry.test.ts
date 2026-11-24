// Cutting a tree like a player who keeps the forest: the whole trunk, never
// a log cabin, and the right saplings planted back on the stumps.
import { beforeEach, expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const Block = require(`${ROOT}/node_modules/prismarine-block`)(registry);
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
useFakeBot({ registry, version: "1.20.4" }); // the catalog reads names from the game data
beforeEach(() => useFakeBot({ registry, version: "1.20.4" }));
const { findTrunk, isNaturalTree, stumpsOf, plantingSpots, saplingFor } = await import(`${ROOT}/src/actions/forestry.ts`);

/** A little world: grass at y=63, air above, plus the given blocks. */
function world(blocks: Record<string, string>) {
  return (p: any) => {
    const k = `${p.x},${p.y},${p.z}`;
    const name = blocks[k] ?? (p.y <= 63 ? "grass_block" : "air");
    const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
    b.position = new Vec3(p.x, p.y, p.z);
    return b;
  };
}
function tree(x: number, z: number, height: number, wood = "oak", canopy = true): Record<string, string> {
  const blocks: Record<string, string> = {};
  for (let y = 64; y < 64 + height; y++) blocks[`${x},${y},${z}`] = `${wood}_log`;
  if (canopy) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const k = `${x + dx},${64 + height},${z + dz}`;
    blocks[k] = `${wood}_leaves`;
  }
  return blocks;
}

test("the whole trunk is cut, not just the 4 lowest logs", () => {
  const at = world(tree(0, 0, 7));
  const trunk = findTrunk(at(new Vec3(0, 64, 0)), at);
  expect(trunk.map((b: any) => b.position.y)).toEqual([64, 65, 66, 67, 68, 69, 70]);
  expect(isNaturalTree(trunk, at)).toBe(true);
  expect(stumpsOf(trunk, at)).toEqual([new Vec3(0, 64, 0)]);
});

test("logs without leaves on top are something built and are left alone", () => {
  const cabin: Record<string, string> = {};
  for (let x = 0; x < 5; x++) for (let y = 64; y < 67; y++) cabin[`${x},${y},0`] = "oak_log";
  const at = world(cabin);
  expect(isNaturalTree(findTrunk(at(new Vec3(0, 64, 0)), at), at)).toBe(false);
});

test("a 2x2 dark oak has four stumps, and gets four saplings or none", () => {
  const blocks = { ...tree(0, 0, 6, "dark_oak"), ...tree(1, 0, 6, "dark_oak"), ...tree(0, 1, 6, "dark_oak"), ...tree(1, 1, 6, "dark_oak") };
  const at = world(blocks);
  const stumps = stumpsOf(findTrunk(at(new Vec3(0, 64, 0)), at), at);
  expect(stumps.length).toBe(4);
  expect(plantingSpots(stumps, "dark_oak_sapling", 4).length).toBe(4);
  expect(plantingSpots(stumps, "dark_oak_sapling", 3)).toEqual([]); // one alone never grows
  expect(plantingSpots(stumps, "jungle_sapling", 2).length).toBe(1); // a small jungle tree then
});

test("each wood plants its own sapling", () => {
  expect(saplingFor("oak_log")).toBe("oak_sapling");
  expect(saplingFor("cherry_log")).toBe("cherry_sapling");
  expect(saplingFor("dark_oak_log")).toBe("dark_oak_sapling");
  expect(saplingFor("mangrove_log")).toBe("mangrove_propagule");
  expect(saplingFor("crimson_stem")).toBeNull(); // nether fungi, not saplings
});

test("a stump on stone (not soil) isn't a place to plant", () => {
  const blocks = tree(0, 0, 5);
  blocks["0,63,0"] = "stone";
  const at = world(blocks);
  expect(stumpsOf(findTrunk(at(new Vec3(0, 64, 0)), at), at)).toEqual([]);
});
