// Where to make its home (owner, 2026-11-27: not in the cold snow taiga;
// trees and animals near; a dry way down for its mine; up to 500 blocks).
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { goodBiome, areaGood, areaScore, areaIssues, LOGS_WANTED, ANIMALS_WANTED, SEARCH_MAX } = await import(`${ROOT}/src/skills/homeSite.ts`);

test("biomes: no snow, ice, frozen ground, desert, ocean, swamp or badlands; beaches and mountains are fine (owner)", () => {
  for (const b of ["snowy_taiga", "snowy_plains", "ice_spikes", "frozen_river", "desert", "deep_ocean", "snowy_beach", "swamp", "mangrove_swamp", "badlands", "eroded_badlands"]) expect(goodBiome(b)).toBe(false);
  for (const b of ["plains", "forest", "taiga", "beach", "windswept_hills", "jagged_peaks", "meadow", "savanna"]) expect(goodBiome(b)).toBe(true);
});

test("a good place: good biome, 24 logs, 3 animals and a dry way down; the best seen ranks the biome and the dry way first", () => {
  expect([LOGS_WANTED, ANIMALS_WANTED, SEARCH_MAX]).toEqual([24, 3, Infinity]);
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

test("the way down for its mine: water, lava or a cave down to the 2nd floor rules a spot out (owner: no cave until the second floor)", async () => {
  const { mineWayProblem } = await import(`${ROOT}/src/skills/homeSite.ts`);
  const { stepAt, hubStep } = await import(`${ROOT}/src/skills/mine.ts`);
  const exit = { x: 0, y: 64, z: 0 };
  // Solid ground from y 63 down; open air above
  const ground = (x: number, y: number, z: number): string => (y <= 63 ? "stone" : "air");
  expect(mineWayProblem(exit, "south", ground)).toBeNull();
  // A cave beside a step deep down (air with stone over it)
  const s = stepAt(exit, "south", hubStep(0) + 3);
  const cave = (x: number, y: number, z: number): string => (x === s.x + 1 && y === s.y + 1 && z === s.z ? "air" : ground(x, y, z));
  expect(mineWayProblem(exit, "south", cave)).toBe("cave");
  // Cave air (carved caves) the same
  const caveAir = (x: number, y: number, z: number): string => (x === s.x && y === s.y && z === s.z ? "cave_air" : ground(x, y, z));
  expect(mineWayProblem(exit, "south", caveAir)).toBe("cave");
  // Water beats it
  const wet = (x: number, y: number, z: number): string => (x === s.x && y === s.y + 2 && z === s.z ? "water" : cave(x, y, z));
  expect(mineWayProblem(exit, "south", wet)).toBe("water");
  // The open air the first steps come out of (nothing over it but leaves) is no cave
  const trees = (x: number, y: number, z: number): string => (y >= 70 && y <= 72 ? "oak_leaves" : ground(x, y, z));
  expect(mineWayProblem(exit, "south", trees)).toBeNull();
});
