// Counting by exact name or Catalog category (never substrings), animals by
// entity type and the registry's "baby" key, and real names in the tier data.
import { beforeEach, expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const carried = [
  ["iron_pickaxe", 1], ["iron_axe", 1], ["stone_axe", 1], ["iron_chestplate", 1], ["chest", 2],
  ["oak_planks", 4], ["cherry_planks", 3], ["stick", 5], ["diamond_sword", 1], ["diamond", 2], ["cherry_log", 6], ["bread", 3],
].map(([name, count]) => ({ name, count }));
const fake = { registry, inventory: { items: () => carried } };
useFakeBot(fake);
beforeEach(() => useFakeBot(fake));
const { getItemCount } = await import(`${ROOT}/src/actions/inventory.ts`);
const { isHuntable } = await import(`${ROOT}/src/utils/minecraftData.ts`);
const { createCatalog } = await import(`${ROOT}/src/core/catalog.ts`);

test("how many axes ignores pickaxes; chest ignores chestplates; diamond ignores diamond tools", () => {
  expect(getItemCount("axe")).toBe(2);
  expect(getItemCount("pickaxe")).toBe(1);
  expect(getItemCount("chest")).toBe(2);
  expect(getItemCount("diamond")).toBe(2);
});

test("categories: planks and logs of every wood, food", () => {
  expect(getItemCount("planks")).toBe(7);
  expect(getItemCount("logs")).toBe(6);
  expect(getItemCount("food")).toBe(3);
  expect(getItemCount("stick")).toBe(5);
  expect(getItemCount("nonsense")).toBe(0);
});

test("hunting: grown animals by entity type; babies and monsters are skipped", () => {
  const babyIndex = registry.entitiesByName.cow.metadataKeys.indexOf("baby");
  const calf = { name: "cow", metadata: { [babyIndex]: true } };
  expect(isHuntable({ name: "cow", metadata: {} } as any)).toBe(true);
  expect(isHuntable(calf as any)).toBe(false);
  expect(isHuntable({ name: "zombie", metadata: {} } as any)).toBe(false);
  expect(isHuntable({ name: "goat", metadata: {} } as any)).toBe(true); // the old fixed list missed it
});

