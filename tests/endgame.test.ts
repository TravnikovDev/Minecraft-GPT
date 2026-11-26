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
  expect(ids.slice(-2)).toEqual(["dragon", "home_again"]);
});

test("the reflex attacks a neutral mob (piglin, enderman, zombified piglin) only after it attacked; spiders only at night", async () => {
  const { mayAttackFirst } = await import(`${ROOT}/src/actions/combat.ts`);
  expect(mayAttackFirst("zombie", false, false)).toBe(true);
  expect(["piglin", "zombified_piglin", "enderman", "warden"].some((n) => mayAttackFirst(n, true, false))).toBe(false);
  expect(mayAttackFirst("zombified_piglin", false, true)).toBe(true); // it hit the bot
  // An enderman that hit it: fought only when strong (game test: 11 health, stone sword, died)
  expect(mayAttackFirst("enderman", true, true, false)).toBe(false);
  expect(mayAttackFirst("enderman", true, true, true)).toBe(true);
  expect([mayAttackFirst("spider", false, false), mayAttackFirst("spider", true, false)]).toEqual([false, true]);
});

test("eyes wanted: 16 before the portal room, what the frame needs plus one after, none once in the End; rods from what's made", async () => {
  const { eyesWanted, rodsWanted } = await import(`${ROOT}/src/skills/endgame/milestones.ts`);
  expect(eyesWanted({})).toBe(16);
  expect(eyesWanted({ endPortal: { x: 0, y: 0, z: 0 }, framesFilled: 3 })).toBe(10);
  expect(eyesWanted({ endVisited: 1 })).toBe(0);
  expect(rodsWanted(0, 0, 16)).toBe(8);
  expect(rodsWanted(10, 1, 16)).toBe(3); // one broken eye doesn't send it back for 8 more
  expect(rodsWanted(16, 0, 16)).toBe(0);
});

test("the stronghold: under a throw that went down for sure; else where two saved throws cross (a guess)", async () => {
  const { strongholdFromThrows } = await import(`${ROOT}/src/skills/endgame/stronghold.ts`);
  expect(strongholdFromThrows([])).toBeNull();
  const a = { x: 0, z: 0, dx: 1000, dz: -500, down: false };
  const b = { x: 0, z: -1000, dx: 1000, dz: 500, down: false };
  const guess = strongholdFromThrows([a, b]);
  expect([Math.round(guess.x), Math.round(guess.z), guess.sure]).toEqual([1000, -500, false]);
  const sure = strongholdFromThrows([a, b, { x: 990, z: -505, dx: 0.1, dz: 0, down: true }]);
  expect([sure.x, sure.z, sure.sure]).toEqual([990, -505, true]);
});

test("obsidian is mined only on solid ground (never off a lava pool's top); milestones are worked on where they belong", async () => {
  const { safeToMine } = await import(`${ROOT}/src/skills/endgame/portal.ts`);
  expect(safeToMine({ name: "stone", boundingBox: "block" })).toBe(true);
  expect(safeToMine({ name: "lava", boundingBox: "empty" })).toBe(false);
  expect(safeToMine(null)).toBe(false);
  const { nextMilestone } = await import(`${ROOT}/src/skills/milestones.ts`);
  const m = (id: string, tier: number, dimension: any, done = false) => ({ id, title: id, tier, dimension, done: () => done, achieve: async () => ({ ok: true }) });
  const list = [m("food", 1, undefined), m("fortress", 4, "any")];
  // In the Nether the first day's food check waits; the fortress is next
  expect(nextMilestone(list as any, () => false, (x: any) => x.dimension === "any")?.id).toBe("fortress");
  expect(nextMilestone(list as any, () => false, () => true)?.id).toBe("food");
});
