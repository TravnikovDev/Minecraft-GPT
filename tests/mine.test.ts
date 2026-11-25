// The mine under the shelter: stairs 10 levels down from the exit to a hub;
// from each hub three tunnels, forward, right, left, 50 blocks each (a
// blocker ends one); then the stairs go 20 steps deeper to the next hub.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { mineBottom, MINE_DEPTH, nextArm, armDirection, hubStep, ARM_LENGTH, LEVEL_STEP } = await import(`${ROOT}/src/skills/mine.ts`);

test("the stairs end 10 down and 10 on from the exit", () => {
  const b = mineBottom({ x: 10, y: 65, z: -17 }, "north");
  expect([b.x, b.y, b.z]).toEqual([10, 65 - MINE_DEPTH, -27]);
});

const arm = (dug: number, blocked = false) => ({ dug, blocked });

test("forward first, then right, then left, each up to 50 blocks", () => {
  expect(nextArm({ forward: arm(0), right: arm(0), left: arm(0) })).toBe("forward");
  expect(nextArm({ forward: arm(35), right: arm(0), left: arm(0) })).toBe("forward");
  expect(nextArm({ forward: arm(ARM_LENGTH), right: arm(0), left: arm(0) })).toBe("right");
  expect(nextArm({ forward: arm(ARM_LENGTH), right: arm(ARM_LENGTH), left: arm(20) })).toBe("left");
  // All three done: time to go deeper
  expect(nextArm({ forward: arm(ARM_LENGTH), right: arm(ARM_LENGTH), left: arm(ARM_LENGTH) })).toBeNull();
});

test("a blocker ends that tunnel; the next one is dug", () => {
  expect(nextArm({ forward: arm(12, true), right: arm(0), left: arm(0) })).toBe("right");
  expect(nextArm({ forward: arm(12, true), right: arm(3, true), left: arm(0) })).toBe("left");
  expect(nextArm({ forward: arm(12, true), right: arm(3, true), left: arm(40, true) })).toBeNull();
});

test("right and left are the stairs' right and left", () => {
  expect(["forward", "right", "left"].map((a) => armDirection(a, "north"))).toEqual(["north", "east", "west"]);
  expect(["forward", "right", "left"].map((a) => armDirection(a, "east"))).toEqual(["east", "south", "north"]);
});

test("hubs: at the stairs' bottom, then every 20 steps deeper", () => {
  expect([0, 1, 2].map(hubStep)).toEqual([MINE_DEPTH, MINE_DEPTH + LEVEL_STEP, MINE_DEPTH + 2 * LEVEL_STEP]);
});
