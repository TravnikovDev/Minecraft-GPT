// The Catalog against real Minecraft 1.20.4 data (the owner's world version).
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const { createCatalog } = await import(`${ROOT}/src/core/catalog.ts`);
const c = createCatalog(registry);

test("unknown names are not found (never 0 / air), and get suggestions", () => {
  expect(c.itemId("iron")).toBeNull();
  expect(c.itemId("air")).not.toBeNull(); // air exists, but only when asked by name
  const v = c.validate("iron");
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.suggestions).toEqual(expect.arrayContaining(["raw_iron"]));
  const blocks = c.validate("iron", "block");
  if (!blocks.ok) expect(blocks.suggestions).toContain("iron_ore");
  expect(c.validate("Oak Planks").ok).toBe(true);
  expect(c.validate("minecraft:oak_planks")).toEqual({ ok: true, name: "oak_planks" });
  expect(c.validate("torches")).toEqual({ ok: true, name: "torch" });
  expect(c.validate("glass")).toEqual({ ok: true, name: "glass" }); // not "glas"
  expect(c.validate("berries")).toEqual({ ok: false, input: "berries", suggestions: expect.any(Array) });
  expect(c.validate("dimond_pickaxe").ok).toBe(false);
  const typo = c.validate("dimond_pickaxe");
  if (!typo.ok) expect(typo.suggestions[0]).toBe("diamond_pickaxe");
});

test("an axe is never a pickaxe", () => {
  expect(c.toolKind("iron_axe")).toBe("axe");
  expect(c.toolKind("iron_pickaxe")).toBe("pickaxe");
  expect(c.toolKind("stick")).toBeNull();
  expect(c.toolTier("stone_pickaxe")).toBeGreaterThan(c.toolTier("wooden_pickaxe"));
  expect(c.toolTier("golden_pickaxe")).toBeLessThan(c.toolTier("stone_pickaxe"));
});

test("every wood type, with the right planks (stripped, stems, hyphae, bamboo)", () => {
  expect(c.woodTypes()).toEqual(expect.arrayContaining(["oak", "cherry", "mangrove", "bamboo", "crimson", "warped"]));
  expect(c.planksFor("cherry_log")).toBe("cherry_planks");
  expect(c.planksFor("stripped_oak_log")).toBe("oak_planks"); // not stripped_oak_planks
  expect(c.planksFor("warped_stem")).toBe("warped_planks");
  expect(c.planksFor("stripped_crimson_hyphae")).toBe("crimson_planks");
  expect(c.planksFor("mangrove_wood")).toBe("mangrove_planks");
  expect(c.planksFor("bamboo_block")).toBe("bamboo_planks");
  expect(c.planksFor("mushroom_stem")).toBeNull();
  expect(c.isLog("mushroom_stem")).toBe(false);
  expect(c.isLog("cherry_log")).toBe(true);
});

test("tools for blocks come from the game data", () => {
  expect(c.toolKindFor("stone")).toBe("pickaxe");
  expect(c.toolKindFor("oak_log")).toBe("axe");
  expect(c.toolKindFor("dirt")).toBe("shovel");
  expect(c.canHarvest("iron_ore", "wooden_pickaxe")).toBe(false);
  expect(c.canHarvest("iron_ore", "stone_pickaxe")).toBe(true);
  expect(c.canHarvest("dirt", null)).toBe(true);
  expect(c.bestToolFor("iron_ore", ["wooden_pickaxe", "iron_pickaxe", "stone_pickaxe", "iron_axe"])).toBe("iron_pickaxe");
  expect(c.bestToolFor("iron_ore", ["wooden_pickaxe"])).toBeNull();
});

test("armor, food, mobs, ores", () => {
  expect(c.armorSlot("iron_chestplate")).toBe("torso");
  expect(c.isArmor("leather_horse_armor")).toBe(false);
  expect(c.armorTier("diamond_helmet")).toBeGreaterThan(c.armorTier("iron_helmet"));
  expect(c.isFood("bread")).toBe(true);
  expect(c.isFood("stick")).toBe(false);
  expect(c.isHostile("zombie")).toBe(true);
  expect(c.isHostile("cow")).toBe(false);
  expect(c.isHuntable("cow")).toBe(true);
  expect(c.isHuntable("creeper")).toBe(false);
  expect(c.dropsOf("iron_ore")).toEqual(["raw_iron"]);
  expect(c.oresFor("raw_iron")).toEqual(expect.arrayContaining(["iron_ore", "deepslate_iron_ore"]));
  expect(c.oresFor("diamond")).toEqual(expect.arrayContaining(["diamond_ore"]));
});

test("loose names against what the bot carries", () => {
  const have = ["heavy_weighted_pressure_plate", "iron_chestplate", "oak_planks", "birch_planks", "glass"];
  expect(c.resolveLoose("pressure plate", have)).toEqual(["heavy_weighted_pressure_plate"]);
  expect(c.resolveLoose("planks", have)).toEqual(["oak_planks", "birch_planks"]);
  expect(c.resolveLoose("glass", have)).toEqual(["glass"]);
  expect(c.resolveLoose("chestplate", have)).toEqual(["iron_chestplate"]);
});
