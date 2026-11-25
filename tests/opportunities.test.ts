// Ores it can see are ranked like a player would: diamond before iron before
// coal; anything that isn't an ore isn't one.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { oreKind, oreRank } = await import(`${ROOT}/src/skills/opportunities.ts`);

test("ore kinds, stone and deepslate alike", () => {
  expect(oreKind("iron_ore")).toBe("iron");
  expect(oreKind("deepslate_iron_ore")).toBe("iron");
  expect(oreKind("coal_ore")).toBe("coal");
  expect(oreKind("nether_gold_ore")).toBe("gold");
  expect(oreKind("stone")).toBeNull();
  expect(oreKind("iron_block")).toBeNull();
});

test("diamond before iron before coal", () => {
  expect(oreRank("diamond")).toBeLessThan(oreRank("iron"));
  expect(oreRank("iron")).toBeLessThan(oreRank("coal"));
});
