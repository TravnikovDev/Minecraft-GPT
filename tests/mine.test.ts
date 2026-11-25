// The mine under the shelter: stairs 10 levels down from the exit, then the
// main tunnel 3 blocks a branch, with side tunnels to the left and right.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { mineBottom, branchAt, MINE_DEPTH } = await import(`${ROOT}/src/skills/mine.ts`);

test("the stairs end 10 down and 10 on from the exit", () => {
  const b = mineBottom({ x: 10, y: 65, z: -17 }, "north");
  expect([b.x, b.y, b.z]).toEqual([10, 65 - MINE_DEPTH, -27]);
});

test("branches every 3 blocks along the main tunnel, sides to the left and right", () => {
  const bottom = { x: 0, y: 40, z: 0 };
  const first = branchAt(bottom, "north", 1);
  expect([first.main.x, first.main.z]).toEqual([0, -3]);
  expect([first.left, first.right]).toEqual(["west", "east"]);
  const fourth = branchAt(bottom, "east", 4);
  expect([fourth.main.x, fourth.main.z]).toEqual([12, 0]);
  expect([fourth.left, fourth.right]).toEqual(["north", "south"]);
});
