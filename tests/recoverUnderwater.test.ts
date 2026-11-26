// Path: tests/recoverUnderwater.test.ts
// Things lost under water with a ceiling over them are left (game test: it
// drowned in its flooded mine, went back for its things and drowned again).
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { drownedUnderCeiling } = await import(`${ROOT}/src/commands/RecoverItems.ts`);

const W = { water: true, solid: false };
const S = { water: false, solid: true };
const A = { water: false, solid: false };

test("water to a ceiling: left; air above the water: gone back for", () => {
  expect(drownedUnderCeiling((dy: number) => (dy <= 2 ? W : S))).toBe(true);
  expect(drownedUnderCeiling((dy: number) => (dy <= 1 ? W : A))).toBe(false);
  // Dry where it died: gone back for
  expect(drownedUnderCeiling(() => A)).toBe(false);
});
