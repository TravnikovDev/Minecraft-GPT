// Apples from oak leaves when starving (owner). Only leaves that grew
// there: a player's placed leaves (a hedge, a roof) are left alone.
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { naturalLeaves } = await import(`${ROOT}/src/skills/apples.ts`);

test("natural leaves are fair game, a player's placed leaves aren't", () => {
  expect(naturalLeaves({ persistent: false, distance: 3 })).toBe(true);
  expect(naturalLeaves({ persistent: true, distance: 7 })).toBe(false);
  expect(naturalLeaves({ persistent: "true" })).toBe(false);
});
