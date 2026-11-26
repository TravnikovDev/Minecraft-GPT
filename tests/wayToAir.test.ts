// The drowning reflex's way to air, and the creeper reflex keeping a creeper
// it just saw. Game test: under a dirt ceiling in a two-high water pocket the
// bot pushed into a wall for 19 seconds and drowned with air a few blocks to
// the side; and a creeper flickering in and out of sight (the bot bobbing in
// water) switched the creeper reflex on and off 700 times in two minutes.
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { wayToAir } = await import(`${ROOT}/src/actions/drowningReflex.ts`);
const { stillTracked } = await import(`${ROOT}/src/actions/creeperReflex.ts`);

type Cell = { water: boolean; open: boolean; level: number } | null;
const WATER: Cell = { water: true, open: false, level: 0 };
const FLOWING: Cell = { water: true, open: false, level: 3 };
const FALLING: Cell = { water: true, open: false, level: 8 };
const AIR: Cell = { water: false, open: true, level: 0 };
const DIRT: Cell = { water: false, open: false, level: 0 };

/** A world from a map of "x,y,z" to cells; everything else is `rest`. */
const world = (cells: Record<string, Cell>, rest: Cell = DIRT) => (x: number, y: number, z: number): Cell =>
  `${x},${y},${z}` in cells ? cells[`${x},${y},${z}`]! : rest;

test("open water: straight up to the surface", () => {
  const cells: Record<string, Cell> = {};
  for (let y = 0; y <= 5; y++) cells[`0,${y},0`] = WATER;
  cells["0,6,0"] = AIR;
  cells["0,7,0"] = AIR;
  const path = wayToAir({ x: 0, y: 0, z: 0 }, world(cells));
  expect(path).not.toBeNull();
  expect(path!.every((p: { x: number; z: number }) => p.x === 0 && p.z === 0)).toBe(true);
  expect(path!.at(-1)).toEqual({ x: 0, y: 5, z: 0 });
});

test("under a ceiling: sideways along the pocket to where it opens up", () => {
  // A two-high pocket from x=0 to x=3 under dirt; at x=3 the water goes up to air
  const cells: Record<string, Cell> = {};
  for (let x = 0; x <= 3; x++) {
    cells[`${x},0,0`] = WATER;
    cells[`${x},1,0`] = WATER;
  }
  cells["3,2,0"] = WATER;
  cells["3,3,0"] = AIR;
  cells["3,4,0"] = AIR;
  const path = wayToAir({ x: 0, y: 0, z: 0 }, world(cells));
  expect(path).not.toBeNull();
  expect(path![1]).toEqual({ x: 1, y: 0, z: 0 }); // first step is to the side, not into the dirt
  expect(path!.at(-1)).toEqual({ x: 3, y: 2, z: 0 });
});

test("a one-high gap is no way: the bot is two blocks tall", () => {
  const cells: Record<string, Cell> = { "0,0,0": WATER, "0,1,0": WATER, "1,0,0": WATER, "2,0,0": WATER, "2,1,0": AIR, "2,2,0": AIR };
  expect(wayToAir({ x: 0, y: 0, z: 0 }, world(cells))).toBeNull();
});

test("falling water is left out (a waterfall carries it off)", () => {
  const cells: Record<string, Cell> = { "0,0,0": WATER, "0,1,0": WATER, "1,0,0": FALLING, "1,1,0": FALLING, "1,2,0": AIR };
  expect(wayToAir({ x: 0, y: 0, z: 0 }, world(cells))).toBeNull();
});

test("flowing water is a way (a tunnel dug into an aquifer fills with it)", () => {
  const cells: Record<string, Cell> = { "0,0,0": WATER, "0,1,0": WATER, "1,0,0": FLOWING, "1,1,0": FLOWING, "1,2,0": AIR };
  const path = wayToAir({ x: 0, y: 0, z: 0 }, world(cells));
  expect(path?.at(-1)).toEqual({ x: 1, y: 1, z: 0 });
});

test("a waterlogged stair is in the way, not water to swim through", () => {
  // The live view marks waterlogged blocks with a collision box as not water and not open
  const STAIR: Cell = { water: false, open: false, level: 0 };
  const cells: Record<string, Cell> = { "0,0,0": WATER, "0,1,0": WATER, "1,0,0": STAIR, "1,1,0": STAIR, "1,2,0": AIR, "1,3,0": AIR };
  expect(wayToAir({ x: 0, y: 0, z: 0 }, world(cells))).toBeNull();
});

test("air over a drop doesn't count as a place to breathe", () => {
  // Out of the pocket sideways into open air with nothing under it
  const cells: Record<string, Cell> = { "0,0,0": WATER, "0,1,0": WATER, "1,0,0": AIR, "1,1,0": AIR, "1,2,0": AIR, "1,-1,0": AIR, "1,-2,0": AIR };
  const path = wayToAir({ x: 0, y: 0, z: 0 }, world(cells), 50);
  // Not the spot over the drop: down the shaft, where there's ground under it
  expect(path?.at(-1)).not.toEqual({ x: 1, y: 0, z: 0 });
  expect(path?.at(-1)).toEqual({ x: 1, y: -2, z: 0 });
});

test("a creeper out of sight for a moment stays the target", () => {
  expect(stillTracked(1_000, 1_500, 9, 13)).toBe(true);
  expect(stillTracked(1_000, 3_500, 9, 13)).toBe(false); // gone for over 2 s
  expect(stillTracked(1_000, 1_500, 14, 13)).toBe(false); // too far now
});

test("a creeper behind its shelter wall doesn't count; one right by it outside does", async () => {
  const { creeperCounts, engagementStalled } = await import(`${ROOT}/src/actions/creeperReflex.ts`);
  // Shut in for the night: only one it can see (in the room with it)
  expect(creeperCounts(4.8, false, true)).toBe(false);
  expect(creeperCounts(3, true, true)).toBe(true);
  // Outside: one right by it counts even when the sight line misses it
  expect(creeperCounts(4.8, false, false)).toBe(true);
  expect(creeperCounts(8, false, false)).toBe(false);
  // 20 s with no hit and no closer: it can't get at it
  expect(engagementStalled(0, 19_000)).toBe(false);
  expect(engagementStalled(0, 21_000)).toBe(true);
});
