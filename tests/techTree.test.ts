// Phase 6: the progression tree comes from the game's own data. Each ore
// needs the pickaxe the game says (coal: wood, iron: stone, diamond: iron,
// obsidian: diamond); everything a furnace makes is a real item.
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const { createCatalog } = require(`${ROOT}/src/core/catalog.ts`);
const { pickaxeFor, SMELTING, STANDS_IN_FOR } = require(`${ROOT}/src/skills/techTree.ts`);
const catalog = createCatalog(registry);

test("each ore needs the pickaxe the game says", () => {
  expect(pickaxeFor("coal", catalog)).toBe("wooden_pickaxe");
  expect(pickaxeFor("raw_iron", catalog)).toBe("stone_pickaxe");
  expect(pickaxeFor("raw_copper", catalog)).toBe("stone_pickaxe");
  expect(pickaxeFor("lapis_lazuli", catalog)).toBe("stone_pickaxe");
  expect(pickaxeFor("diamond", catalog)).toBe("iron_pickaxe");
  expect(pickaxeFor("raw_gold", catalog)).toBe("iron_pickaxe");
  expect(pickaxeFor("redstone", catalog)).toBe("iron_pickaxe");
  expect(pickaxeFor("oak_log", catalog)).toBeNull(); // not from ores
});

test("everything a furnace makes, and what it makes it from, is a real 1.20.4 item", () => {
  for (const [out, input] of Object.entries(SMELTING) as [string, string][]) {
    expect(registry.itemsByName[out]).toBeDefined();
    if (input !== "logs") expect(registry.itemsByName[input]).toBeDefined();
  }
  for (const [alt, main] of Object.entries(STANDS_IN_FOR) as [string, string][]) {
    expect(registry.itemsByName[alt]).toBeDefined();
    expect(registry.itemsByName[main]).toBeDefined();
  }
});

test("a torch can be made with charcoal as well as coal (the game has both recipes)", () => {
  const torch = registry.itemsByName["torch"].id;
  const inputs = (registry.recipes[torch] ?? []).map((r: any) => JSON.stringify(r.inShape ?? r.ingredients));
  const ids = (name: string) => String(registry.itemsByName[name].id);
  expect(inputs.some((s: string) => s.includes(ids("coal")))).toBe(true);
  expect(inputs.some((s: string) => s.includes(ids("charcoal")))).toBe(true);
});
