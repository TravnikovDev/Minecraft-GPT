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

test("ore chores: by day anywhere near; at night only under ground; never far down (review)", async () => {
  const { oreAllowedNow } = await import("../src/skills/opportunities");
  const spot = { day: true, botUnderRoof: false, oreUnderSky: true, botY: 70, oreY: 68 };
  expect(oreAllowedNow(spot)).toBe(true);
  // Night out in the open: no
  expect(oreAllowedNow({ ...spot, day: false })).toBe(false);
  // Night in its mine, the ore in the rock: yes; the ore out under the sky: no
  expect(oreAllowedNow({ ...spot, day: false, botUnderRoof: true, oreUnderSky: false })).toBe(true);
  expect(oreAllowedNow({ ...spot, day: false, botUnderRoof: true, oreUnderSky: true })).toBe(false);
  // Far below its feet: left for the mine, day or night
  expect(oreAllowedNow({ ...spot, oreY: 60 })).toBe(false);
});
