// Path: tests/foodWatch.test.ts
// Keeping itself fed (game test: it starved to death twice in twenty minutes).
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { foodNeed } = await import(`${ROOT}/src/skills/foodWatch.ts`);

test("starving with nothing on it: food now, by day from a hunger bar of 6, at night only when it's empty", () => {
  expect(foodNeed(6, 0, true, false)).toBe("emergency");
  expect(foodNeed(6, 0, false, true)).toBeNull();
  expect(foodNeed(0, 0, false, true)).toBe("emergency");
  // Food on it: it eats that (upkeep), no emergency
  expect(foodNeed(4, 8, true, true)).toBe("restock");
});

test("running low while living its own life: a restock by day; plenty: nothing", () => {
  expect(foodNeed(18, 6, true, true)).toBe("restock");
  expect(foodNeed(18, 6, true, false)).toBeNull();
  expect(foodNeed(18, 6, false, true)).toBeNull();
  expect(foodNeed(18, 30, true, true)).toBeNull();
});

test("food stock: walks out to a herd by day when low, not only when starving (owner: an hour starving with cows 50 blocks off)", async () => {
  const { walkToHerd, huntCount, foodToKeep } = await import(`${import.meta.dir}/../src/skills/milestones.ts`);
  expect(walkToHerd(55, 4, 9, false)).toBe(true); // a herd 55 off, health 9: goes
  expect(walkToHerd(55, 4, 5, false)).toBe(false); // too hurt for the walk while not starving
  expect(walkToHerd(55, 4, 1, true)).toBe(true); // starving: goes anyway
  expect(walkToHerd(80, 1, 20, false)).toBe(false); // not 80 blocks for one chicken
  expect(walkToHerd(80, 2, 20, false)).toBe(true); // a pair is worth the walk now (owner: none left to breed)
  expect(walkToHerd(20, 1, 20, false)).toBe(true); // one close by is fine
  expect(walkToHerd(140, 6, 20, false)).toBe(true); // owner: animals scanned for 150 blocks
  expect(walkToHerd(160, 6, 20, true)).toBe(false); // too far
  expect(walkToHerd(null, 0, 20, true)).toBe(false);
  // Enough animals for the stock and the reserve: about 6 food points a head, 3 to 10
  expect(huntCount(50)).toBe(9);
  expect(huntCount(4)).toBe(3);
  expect(huntCount(200)).toBe(10);
  // The best food stays on it (20 points); the rest goes in the chests
  const keep = foodToKeep([{ name: "bread", count: 6, points: 5 }, { name: "cooked_beef", count: 4, points: 8 }], 20);
  expect(keep).toEqual({ cooked_beef: 3, bread: 0 });
});

test("no animals about: it looks in a direction over dry land, up to 75 blocks (owner)", async () => {
  const { dryDirection, ANIMAL_WALK } = await import(`${import.meta.dir}/../src/skills/explore.ts`);
  expect(ANIMAL_WALK).toBe(75);
  // A lake to the north and east of it: never walked into
  const lake = (x: number, z: number): "water" | "land" => (z < -10 || x > 10 ? "water" : "land");
  const [name, dx, dz] = dryDirection({ x: 0, z: 0 }, 75, lake, () => 0);
  expect(dz).toBeGreaterThanOrEqual(0);
  expect(dx).toBeLessThanOrEqual(0);
  expect(["south", "west", "south-west"]).toContain(name);
  // Of the dry ones, the one not tried lately
  const tried: Record<string, number> = { south: 5, "south-west": 5 };
  expect(dryDirection({ x: 0, z: 0 }, 75, lake, (n) => tried[n] ?? 0)[0]).toBe("west");
});

test("nearly dead or at an empty bar with food on it: eaten at once (game test: it starved holding porkchops)", async () => {
  const { mustEatNow } = await import(`${import.meta.dir}/../src/actions/upkeep.ts`);
  expect(mustEatNow(0.5, 0)).toBe(true);
  expect(mustEatNow(3, 12)).toBe(true);
  expect(mustEatNow(20, 0)).toBe(true);
  expect(mustEatNow(15, 10)).toBe(false); // hungry but fine: between actions
  expect(mustEatNow(2, 20)).toBe(false); // full: nothing to eat for
});
