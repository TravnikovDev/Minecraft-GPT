// Phase 9: the late game's geometry, without a game: the portal frame, where
// two eyes of ender cross, and safe ground on the End island.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { portalFrame, triangulate, secondThrowSpot, safeOnIsland, eyesNeeded } = await import(`${ROOT}/src/skills/endgame/geometry.ts`);

test("the smallest portal: 10 obsidian (no corners), 6 cells inside", () => {
  const { frame, inside } = portalFrame({ x: 0, y: 64, z: 0 }, "x");
  expect(frame.length).toBe(10);
  expect(inside.length).toBe(6);
  const has = (cells: any[], x: number, y: number) => cells.some((c) => c.x === x && c.y === y && c.z === 0);
  expect(has(frame, 0, 63) && has(frame, 1, 63) && has(frame, 0, 67) && has(frame, -1, 65) && has(frame, 2, 66)).toBe(true);
  expect(has(frame, -1, 63)).toBe(false); // corners not needed
  expect(has(inside, 1, 66) && !has(inside, 2, 64)).toBe(true);
  const z = portalFrame({ x: 5, y: 70, z: 5 }, "z");
  expect(z.frame.every((c: any) => c.x === 5)).toBe(true);
});

test("two eyes thrown from two spots cross at the stronghold", () => {
  // Stronghold at (1000, -500): from (0,0) and from (0,-1000)
  const target = { x: 1000, z: -500 };
  const p1 = { x: 0, z: 0 };
  const p2 = { x: 0, z: -1000 };
  const d1 = { x: target.x - p1.x, z: target.z - p1.z };
  const d2 = { x: target.x - p2.x, z: target.z - p2.z };
  const at = triangulate(p1, d1, p2, d2);
  expect(at!.x).toBeCloseTo(1000, 6);
  expect(at!.z).toBeCloseTo(-500, 6);
  // Almost parallel, or crossing behind the thrower: no answer
  expect(triangulate(p1, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 0.01 })).toBeNull();
  expect(triangulate(p1, { x: 1, z: 0 }, { x: 5, z: 5 }, { x: 0, z: 1 })).toBeNull();
});

test("the second throw is off to the side of the first eye's line", () => {
  const s = secondThrowSpot({ x: 0, z: 0 }, { x: 1, z: 0 }, 100);
  expect([Math.round(s.x), Math.round(s.z)]).toEqual([0, 100]);
});

test("safe on the End island: near the centre, on end stone, obsidian or bedrock", () => {
  expect(safeOnIsland({ x: 10, z: 10 }, "end_stone")).toBe(true);
  expect(safeOnIsland({ x: 10, z: 10 }, "air")).toBe(false);
  expect(safeOnIsland({ x: 70, z: 0 }, "end_stone")).toBe(false);
  expect(eyesNeeded()).toBe(16);
  expect(eyesNeeded(10, 2)).toBe(4);
});

test("the late-game milestones come after diamonds, each needing only milestones before it", async () => {
  const { MILESTONES } = await import(`${ROOT}/src/skills/milestones.ts`);
  const ids = MILESTONES.map((m: any) => m.id);
  MILESTONES.forEach((m: any, i: number) => {
    for (const r of m.requires ?? []) expect(ids.indexOf(r)).toBeGreaterThanOrEqual(0), expect(ids.indexOf(r)).toBeLessThan(i);
  });
  expect(ids.indexOf("nether_portal")).toBeGreaterThan(ids.indexOf("diamond_pickaxe"));
  expect(ids.at(-1)).toBe("dragon");
});
