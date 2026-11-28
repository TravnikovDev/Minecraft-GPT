// Gear it carries and doesn't use goes to its chests or the furnace; its
// diamond gear is made in order as the diamonds come.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
useFakeBot({ registry, inventory: { items: () => [], slots: [] } });
const { spareGear } = await import(`${ROOT}/src/actions/storage.ts`);
const { oldWoodenTool } = await import(`${ROOT}/src/actions/fuel.ts`);
const M = await import(`${ROOT}/src/skills/milestones.ts`);
const { diamondsDeeper, ARM_LENGTH } = await import(`${ROOT}/src/skills/mine.ts`);

const it = (name: string, count = 1) => ({ name, count });
const asMap = (w: Array<{ name: string; count: number }>) => Object.fromEntries(w.map((x) => [x.name, x.count]));

test("spare gear: the best of each tool kind and one stone fallback stay; old wooden ones stay for the furnace", () => {
  const bag = [
    it("iron_pickaxe"), it("stone_pickaxe", 3), it("wooden_axe"), it("stone_axe"), it("iron_axe"),
    it("wooden_shovel"), it("stone_shovel"), it("iron_shovel"), it("wooden_sword"), it("stone_sword"), it("iron_sword"),
    it("stone_hoe"), it("cobblestone", 64),
  ];
  // Of 3 stone pickaxes one stays as the fallback; the axes, shovels and swords keep iron and stone
  expect(asMap(spareGear(bag))).toEqual({ stone_pickaxe: 2 });
  // Its only hoe stays; wooden tools with better ones aren't stored (burned instead)
  expect(oldWoodenTool(bag)).not.toBeNull();
  expect(oldWoodenTool([it("wooden_pickaxe"), it("stone_axe")])).toBeNull(); // its only pickaxe
});

test("spare gear: below an iron pickaxe 3 pickaxes go down the mine; armour no better than what it wears goes", () => {
  expect(spareGear([it("stone_pickaxe", 4)])).toEqual([{ name: "stone_pickaxe", count: 1 }]);
  expect(asMap(spareGear([it("iron_chestplate"), it("leather_boots")], ["diamond_chestplate", "iron_boots"]))).toEqual({ iron_chestplate: 1, leather_boots: 1 });
  expect(spareGear([it("diamond_helmet")], ["iron_helmet"])).toEqual([]); // better than what it wears: put on, not away
});

test("diamond gear in order: pickaxe, sword, chestplate, leggings, helmet, boots (29 diamonds)", () => {
  const has = (owned: string[]) => (item: string) => owned.includes(item);
  expect(M.nextDiamondPiece(has([]))).toEqual(["diamond_pickaxe", 3]);
  expect(M.nextDiamondPiece(has(["diamond_pickaxe"]))).toEqual(["diamond_sword", 2]);
  expect(M.nextDiamondPiece(has(["diamond_pickaxe", "diamond_sword"]))).toEqual(["diamond_chestplate", 8]);
  expect(M.diamondsStillWanted(has([]))).toBe(29);
  expect(M.diamondsStillWanted(has(["diamond_pickaxe", "diamond_sword", "diamond_chestplate"]))).toBe(16);
  // Made at the nearest table when it carries it all; a tool needs the wood for its sticks, armour doesn't
  expect(M.diamondPieceCarried("diamond_sword", 2, [it("diamond", 2), it("stick", 2)])).toBe(true);
  expect(M.diamondPieceCarried("diamond_sword", 2, [it("diamond", 2)])).toBe(false);
  expect(M.diamondPieceCarried("diamond_chestplate", 8, [it("diamond", 8)])).toBe(true);
  expect(M.diamondPieceCarried("diamond_chestplate", 8, [it("diamond", 7)])).toBe(false);
});

test("a diamond trip goes on down from a floor above y -40 once a tunnel there is done", () => {
  const fresh = { dug: 0, blocked: false };
  const done = { dug: ARM_LENGTH, blocked: false };
  expect(diamondsDeeper({ forward: done, right: fresh, left: fresh, back: fresh }, -11)).toBe(true);
  expect(diamondsDeeper({ forward: fresh, right: fresh, left: fresh, back: fresh }, -11)).toBe(false);
  expect(diamondsDeeper({ forward: done, right: fresh, left: fresh, back: fresh }, -51)).toBe(false);
});
