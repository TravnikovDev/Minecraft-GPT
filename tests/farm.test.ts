// A farm of its own (owner: hunting isn't sustainable; a plot by the
// shelter with water in it). The plot must be flat grass or dirt, clear
// over it, and never on what it keeps (its shelter, its stairs).
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { plotFits, FARM_HALF } = await import(`${ROOT}/src/skills/farm.ts`);

type Cell = { ground: boolean; clear: boolean } | null;
const flat = (groundY: number) => (_x: number, y: number): Cell => (y === groundY ? { ground: true, clear: false } : y === groundY + 1 ? { ground: false, clear: true } : { ground: false, clear: false });

test("a flat 9 x 9 of grass with air over it fits", () => {
  expect(FARM_HALF).toBe(4);
  expect(plotFits({ x: 0, y: 63, z: 0 }, flat(63))).toBe(true);
});

test("a step in the ground, a tree on it or a kept cell spoils the plot", () => {
  const stepped = (x: number, y: number, z: number): Cell => (x === 4 && z === 4 ? flat(64)(x, y) : flat(63)(x, y));
  expect(plotFits({ x: 0, y: 63, z: 0 }, stepped)).toBe(false);
  const tree = (x: number, y: number, z: number): Cell => (x === -2 && z === 1 && y === 64 ? { ground: false, clear: false } : flat(63)(x, y));
  expect(plotFits({ x: 0, y: 63, z: 0 }, tree)).toBe(false);
  const keptCell = (p: { x: number; y: number; z: number }) => p.x === 3 && p.z === -3;
  expect(plotFits({ x: 0, y: 63, z: 0 }, flat(63), keptCell)).toBe(false);
});
