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
