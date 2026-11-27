// Taking down its scaffolding without building more (owner, 2026-11-28: it
// built scaffolding to take scaffolding down, then took the new blocks down
// first, in a loop). A pillar too tall to reach from the ground is climbed
// beside and taken down on the way back.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
useFakeBot({});
const ROOT = `${import.meta.dir}/..`;
const { columnOf, tooTallFromGround } = await import(`${ROOT}/src/actions/scaffolding.ts`);

const pillar = (x: number, z: number, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ x, y: from + i, z }));

test("a pillar's cells, highest first; other columns left out", () => {
  const cells = [...pillar(0, 0, 64, 70), ...pillar(1, 0, 64, 65)];
  const col = columnOf(cells, 0, 0);
  expect(col.length).toBe(7);
  expect(col[0].y).toBe(70);
  expect(col[6].y).toBe(64);
});

test("a pillar 4 or more over its foot is out of reach from the ground; a short one isn't", () => {
  expect(tooTallFromGround(pillar(0, 0, 64, 70))).toBe(true);
  expect(tooTallFromGround(pillar(0, 0, 64, 68))).toBe(true);
  expect(tooTallFromGround(pillar(0, 0, 64, 67))).toBe(false);
  expect(tooTallFromGround([])).toBe(false);
});
