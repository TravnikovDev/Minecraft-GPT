// Ores it stops mining once it owns plenty (owner, 2026-11-28: no more
// copper past 32 (it was 64, then 40); raw copper, ingots and blocks, carried and stored).
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
useFakeBot({});
const ROOT = `${import.meta.dir}/..`;
const { oreKindOf, ownedOre, oreCappedBy, ORE_CAPS } = await import(`${ROOT}/src/skills/oreCaps.ts`);

test("copper ore and raw copper are capped at 32; other ores never", () => {
  expect(ORE_CAPS.copper).toBe(32);
  expect(oreKindOf("copper_ore")).toBe("copper");
  expect(oreKindOf("deepslate_copper_ore")).toBe("copper");
  expect(oreKindOf("raw_copper")).toBe("copper");
  for (const n of ["iron_ore", "coal_ore", "coal", "raw_iron", "diamond_ore"]) expect(oreKindOf(n)).toBeNull();
});

test("owned copper counts raw copper, ingots and blocks (9 each); 32 or more stops the mining", () => {
  const have = (m: Record<string, number>) => (item: string) => m[item] ?? 0;
  expect(ownedOre("copper", have({ raw_copper: 20, copper_ingot: 24, raw_copper_block: 2 }))).toBe(62);
  expect(oreCappedBy("copper", have({ raw_copper: 2, copper_ingot: 11, raw_copper_block: 2 }))).toBe(false); // 31
  expect(oreCappedBy("copper", have({ raw_copper: 3, copper_ingot: 11, raw_copper_block: 2 }))).toBe(true); // 32
  expect(oreCappedBy("iron", have({ raw_iron: 500 }))).toBe(false);
});
