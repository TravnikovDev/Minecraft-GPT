// A farm of its own (owner: hunting isn't sustainable; a plot by the
// shelter with water in it). The plot must be flat grass or dirt, clear
// over it, and never on what it keeps (its shelter, its stairs).
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { plotFits, FARM_HALF, sowOrder, torchSpots } = await import(`${ROOT}/src/skills/farm.ts`);

type Cell = { ground: boolean; clear: boolean; sky?: boolean; tree?: boolean } | null;
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

test("in the shade of trees or right beside one, no farm (game test: squeezed between oaks)", () => {
  const shaded = (x: number, y: number, z: number): Cell => (x === 1 && z === 1 && y === 63 ? { ground: true, clear: false, sky: false } : flat(63)(x, y));
  expect(plotFits({ x: 0, y: 63, z: 0 }, shaded)).toBe(false);
  const trunkBeside = (x: number, y: number, z: number): Cell => (x === 5 && z === 2 && y === 64 ? { ground: false, clear: false, tree: true } : flat(63)(x, y));
  expect(plotFits({ x: 0, y: 63, z: 0 }, trunkBeside)).toBe(false);
});

test("sown from the water outward: a few seeds make a patch round it, not a strip at the edge", () => {
  const order = sowOrder({ x: 0, y: 63, z: 0 });
  expect(order.length).toBe(80);
  expect(order.slice(0, 8).every((p: { x: number; z: number }) => Math.max(Math.abs(p.x), Math.abs(p.z)) === 1)).toBe(true);
  expect(order.some((p: { x: number; z: number }) => p.x === 0 && p.z === 0)).toBe(false);
});

test("four torches by the sides light every cell to 9 or more (crops grow at night)", () => {
  const torches = torchSpots({ x: 0, y: 63, z: 0 });
  for (let x = -FARM_HALF; x <= FARM_HALF; x++)
    for (let z = -FARM_HALF; z <= FARM_HALF; z++) {
      const light = Math.max(...torches.map((t: { x: number; z: number }) => 14 - Math.abs(t.x - x) - Math.abs(t.z - z)));
      expect(light).toBeGreaterThanOrEqual(9);
    }
});
