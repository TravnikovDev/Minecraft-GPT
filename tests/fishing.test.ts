// Fishing for food (owner: with string it makes a rod and fishes by day).
// It stands on the shore of open water: a solid block beside the water,
// level with its surface, with room over it.
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { shoreFor } = await import(`${ROOT}/src/skills/fishing.ts`);

type Cell = { water: boolean; solid: boolean; open: boolean } | null;
const WATER: Cell = { water: true, solid: false, open: false };
const GROUND: Cell = { water: false, solid: true, open: false };
const AIR: Cell = { water: false, solid: false, open: true };

test("the shore beside a pond's water: on the bank, level with the water", () => {
  // Water at (0, 62, 0); the bank at x=1 is ground at 62 with air over it
  const look = (x: number, y: number, z: number): Cell => {
    if (x === 0 && z === 0) return y <= 62 ? WATER : AIR;
    if (x === 1 && z === 0) return y <= 62 ? GROUND : AIR;
    return y <= 62 ? WATER : AIR; // more water around
  };
  expect(shoreFor({ x: 0, y: 62, z: 0 }, look)).toEqual({ x: 1, y: 63, z: 0 });
});

test("no shore: water all round, or a cliff with no room to stand", () => {
  const sea = (_x: number, y: number): Cell => (y <= 62 ? WATER : AIR);
  expect(shoreFor({ x: 0, y: 62, z: 0 }, sea)).toBeNull();
  const cliff = (x: number, y: number, z: number): Cell => (x === 0 && z === 0 ? (y <= 62 ? WATER : AIR) : GROUND);
  expect(shoreFor({ x: 0, y: 62, z: 0 }, cliff)).toBeNull();
});
