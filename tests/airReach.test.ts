// Mobs behind the rock don't count (owner, 2026-11-28: "inside its mine, can
// it just not care about zombies behind the walls?").
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
useFakeBot({});
const ROOT = `${import.meta.dir}/..`;
const { airAround, inAir, passable } = await import(`${ROOT}/src/actions/airReach.ts`);

type P = { x: number; y: number; z: number };
const stone = { name: "stone", boundingBox: "block" };
const air = { name: "air", boundingBox: "empty" };

// A tunnel 2 high along x (y 0..1, z 0), x 0..20; a cave (x 0..4, y 0..1, z 3..5) behind 2 blocks of rock
const tunnel = (p: P): boolean => p.z === 0 && p.y >= 0 && p.y <= 1 && p.x >= 0 && p.x <= 20;
const cave = (p: P): boolean => p.z >= 3 && p.z <= 5 && p.y >= 0 && p.y <= 1 && p.x >= 0 && p.x <= 4;

test("a zombie behind its tunnel's wall can't get at it; one in its tunnel can", () => {
  const world = (p: P) => (tunnel(p) || cave(p) ? air : stone);
  const a = airAround([{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], world);
  expect(a).not.toBeNull();
  expect(inAir(a, { x: 15.5, y: 0, z: 0.5 })).toBe(true); // down its tunnel
  expect(inAir(a, { x: 2.5, y: 0, z: 4.5 })).toBe(false); // in the cave behind the rock
});

test("an opening joins them: then the cave's zombie counts; a door counts as open", () => {
  const hole = (p: P) => p.x === 2 && p.y === 0 && (p.z === 1 || p.z === 2);
  expect(inAir(airAround([{ x: 0, y: 0, z: 0 }], (p: P) => (tunnel(p) || cave(p) || hole(p) ? air : stone)), { x: 2.5, y: 0, z: 4.5 })).toBe(true);
  const door = (p: P) => (hole(p) ? { name: "oak_door", boundingBox: "block" } : tunnel(p) || cave(p) ? air : stone);
  expect(inAir(airAround([{ x: 0, y: 0, z: 0 }], door), { x: 2.5, y: 0, z: 4.5 })).toBe(true);
  expect(passable(null)).toBe(false);
});

test("out in the open (lots of air) every mob counts, as before", () => {
  expect(airAround([{ x: 0, y: 0, z: 0 }], () => air, 26, 500)).toBeNull();
  expect(inAir(null, { x: 9, y: 9, z: 9 })).toBe(true);
});
