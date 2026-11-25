// The drowning reflex swims forward only where there's a floor ahead: at the
// top of a waterfall it pushed on into the falling water and fell, three times.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { isDropAhead } = await import(`${ROOT}/src/actions/drowningReflex.ts`);

const air = { name: "air", boundingBox: "empty" };
const stone = { name: "stone", boundingBox: "block" };
const water = (level: number) => ({ name: "water", boundingBox: "empty", level });

test("a bank or shallow still water ahead is a floor", () => {
  expect(isDropAhead([air, stone])).toBe(false);
  expect(isDropAhead([water(0), stone])).toBe(false);
});

test("falling or flowing water over a long fall is a drop", () => {
  expect(isDropAhead([water(8), water(8), water(8), water(8)])).toBe(true);
  expect(isDropAhead([water(3), air, air, air])).toBe(true);
  expect(isDropAhead([air, air, air, air])).toBe(true);
});

test("deep still water with nothing under it within 3 is a drop", () => {
  expect(isDropAhead([water(0), water(0), water(0), water(0)])).toBe(true);
});
