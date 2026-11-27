// Ore in the open round its home first (owner: a ravine of coal, iron and
// copper right by the shelter, and it went down its mine instead).
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { surfaceTargets } = await import(`${ROOT}/src/skills/surfaceOres.ts`);

const home = { x: 0, y: 64, z: 0 };

test("open ore near home is taken, nearest home first", () => {
  const ores = [
    { x: 20, y: 60, z: 0, open: true },
    { x: 5, y: 62, z: 3, open: true },
  ];
  expect(surfaceTargets(home, ores)).toEqual([{ x: 5, y: 62, z: 3, open: true }, { x: 20, y: 60, z: 0, open: true }]);
});

test("buried ore, ore far off and ore deep down are left to the mine", () => {
  const ores = [
    { x: 4, y: 63, z: 0, open: false }, // buried
    { x: 40, y: 64, z: 0, open: true }, // past 32 blocks
    { x: 3, y: 30, z: 0, open: true }, // a deep cave under the home
  ];
  expect(surfaceTargets(home, ores)).toEqual([]);
});

test("in the open means air the sky lights, not a dark cave (game test: a walk dug its own way 20 blocks down to cave coal)", async () => {
  const { openToSky } = await import(`${ROOT}/src/skills/surfaceOres.ts`);
  const ore = { x: 0, y: 50, z: 0 };
  const world = (air: { name: string; skyLight: number }) => (p: { x: number; y: number; z: number }) => (p.x === 1 && p.y === 50 && p.z === 0 ? air : { name: "stone", skyLight: 0 });
  expect(openToSky(ore, world({ name: "air", skyLight: 12 }))).toBe(true); // a ravine's wall
  expect(openToSky(ore, world({ name: "air", skyLight: 0 }))).toBe(false); // a cave
  expect(openToSky(ore, world({ name: "water", skyLight: 15 }))).toBe(false); // under a pond
});
