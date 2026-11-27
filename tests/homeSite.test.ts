// Where to make its home (owner, 2026-11-27: not in the cold snow taiga;
// trees and animals near; a dry way down for its mine; up to 500 blocks).
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { goodBiome, areaGood, areaScore, areaIssues, LOGS_WANTED, ANIMALS_WANTED, SEARCH_MAX } = await import(`${ROOT}/src/skills/homeSite.ts`);

test("biomes: no snow, ice, frozen ground, desert or ocean; beaches and mountains are fine (owner)", () => {
  for (const b of ["snowy_taiga", "snowy_plains", "ice_spikes", "frozen_river", "desert", "deep_ocean", "snowy_beach"]) expect(goodBiome(b)).toBe(false);
  for (const b of ["plains", "forest", "taiga", "beach", "windswept_hills", "jagged_peaks", "meadow", "savanna"]) expect(goodBiome(b)).toBe(true);
});

test("a good place: good biome, 24 logs, 3 animals and a dry way down; the best seen ranks the biome and the dry way first", () => {
  expect([LOGS_WANTED, ANIMALS_WANTED, SEARCH_MAX]).toEqual([24, 3, 500]);
  const good = { biome: "forest", goodBiome: true, logs: 24, animals: 3, dryMine: true };
  expect(areaGood(good)).toBe(true);
  expect(areaGood({ ...good, logs: 10 })).toBe(false);
  expect(areaGood({ ...good, dryMine: false })).toBe(false);
  const snowy = { biome: "snowy_taiga", goodBiome: false, logs: 24, animals: 6, dryMine: true };
  const wetForest = { ...good, dryMine: false };
  expect(areaScore(good)).toBeGreaterThan(areaScore(wetForest));
  expect(areaScore(wetForest)).toBeGreaterThan(areaScore(snowy));
  expect(areaIssues(snowy)).toContain("snowy taiga is a hard place to live");
});
