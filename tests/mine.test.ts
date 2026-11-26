// The mine under the shelter: stairs 10 levels down from the exit to a hub;
// from each hub three tunnels, forward, right, left, 50 blocks each (a
// blocker ends one); then the stairs go 20 steps deeper to the next hub.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { mineBottom, MINE_DEPTH, nextArm, armDirection, hubStep, ARM_LENGTH, LEVEL_STEP, stepsToPave, mineStairCells } = await import(`${ROOT}/src/skills/mine.ts`);

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

test("paving: every step below the doorway, hubs and the bottom step too", () => {
  // Owner: a flat hub between paved steps is a step and a half up, which no one can walk
  // Stairs down to the first hub (steps 0..10): steps 1..10 (10 is the hub, paved from its forward tunnel)
  expect(stepsToPave(11)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // Dug on to the second hub (steps 0..30): both hubs paved, the doorway's step never
  const deep = stepsToPave(31);
  expect(deep).not.toContain(0);
  expect(deep).toContain(10);
  expect(deep).toContain(30);
  expect(deep.length).toBe(30);
});

test("the stairs' floors and side walls are kept; hubs stay open to the sides; the doorway is the shelter's", () => {
  // Stairs south from (0, 64, 0): step i stands at (0, 64 - i, i)
  const { keep, walk } = mineStairCells({ x: 0, y: 64, z: 0 }, "south", 12, 0);
  const has = (cells: Array<{ x: number; y: number; z: number }>, x: number, y: number, z: number): boolean => cells.some((c) => c.x === x && c.y === y && c.z === z);
  // Step 5: floor under it, walls east and west from floor to the top of its 4-high space
  expect(has(keep, 0, 58, 5)).toBe(true);
  for (const dy of [-1, 0, 1, 2, 3]) {
    expect(has(keep, 1, 59 + dy, 5)).toBe(true);
    expect(has(keep, -1, 59 + dy, 5)).toBe(true);
  }
  // The roof over each step down to the first hub (a walk dug down into the
  // stairs from the grass); not deeper, where the forward tunnel passes over
  expect(has(keep, 0, 63, 5)).toBe(true);
  expect(has(keep, 0, 64 - 11 + 4, 11)).toBe(false);
  // Never the step's own cells (it walks there) nor the doorway
  expect(has(keep, 0, 59, 5)).toBe(false);
  expect(has(keep, 0, 63, 0)).toBe(false);
  // The hub (step 10): floor kept, sides open for the right and left tunnels
  expect(has(keep, 0, 53, 10)).toBe(true);
  expect(has(keep, 1, 54, 10)).toBe(false);
  expect(has(walk, 0, 59, 5)).toBe(true);
  expect(has(walk, 0, 62, 5)).toBe(true); // 4 high (owner: 3 was too low)
});

test("the ground over its home is protected up to over the surface, its own open cells never", async () => {
  const { overburden } = await import(`${ROOT}/src/actions/building.ts`);
  const { Vec3 } = await import(`${ROOT}/node_modules/vec3`);
  // A room cell at y 57 with its roof at 60; the surface at 62
  const open = [new Vec3(7, 57, 8), new Vec3(7, 58, 8), new Vec3(7, 59, 8)];
  const shell = [new Vec3(7, 60, 8)];
  const cells = overburden(open, shell, 63);
  expect(cells.map((c: any) => c.y)).toEqual([61, 62, 63]);
  expect(cells.some((c: any) => c.y <= 59)).toBe(false);
});

test("not down the mine hurt or without food", async () => {
  const { fitForTheMine } = await import(`${ROOT}/src/skills/mine.ts`);
  expect(fitForTheMine(20, 20).ok).toBe(true);
  expect(fitForTheMine(12, 6).ok).toBe(true);
  const hurt = fitForTheMine(9, 20);
  expect(hurt.ok).toBe(false);
  expect(hurt.detail).toContain("hurt");
  const hungry = fitForTheMine(20, 3);
  expect(hungry.ok).toBe(false);
  expect(hungry.reason).toBe("missing_items");
});

test("the stairs down to the shelter are part of its shell: floor, side walls and roof below the surface", async () => {
  const { stairsShell } = await import(`${ROOT}/src/actions/building.ts`);
  const { Vec3 } = await import(`${ROOT}/node_modules/vec3`);
  // Two steps going +x from the surface at y=64, 2 cells tall
  const stairs = [new Vec3(0, 64, 0), new Vec3(0, 65, 0), new Vec3(1, 63, 0), new Vec3(1, 64, 0)];
  const shell = stairsShell(stairs, [], new Vec3(0, 0, 1), 64);
  const has = (x: number, y: number, z: number) => shell.some((p: { x: number; y: number; z: number }) => p.x === x && p.y === y && p.z === z);
  expect(has(0, 63, 0)).toBe(true); // floor under the top step
  expect(has(1, 62, 0)).toBe(true); // floor under the second step
  expect(has(1, 63, 1) && has(1, 63, -1)).toBe(true); // side walls below the surface
  expect(has(0, 64, 1)).toBe(false); // at the surface: the open world, not a wall
  expect(has(1, 64, 0)).toBe(false); // a stair cell is never part of the shell
});

test("the shelter's shell keeps its doorways' floors but never closes the way through", async () => {
  const { shelterPlan } = await import(`${ROOT}/src/actions/building.ts`);
  const plan = shelterPlan({ x: 0, y: 64, z: 0 }, "south");
  const key = (p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`;
  const shell = new Set(plan.shell.map(key));
  // Nothing it walks through is ever a wall to build
  for (const c of plan.cells) expect(shell.has(key(c))).toBe(false);
  // The doorways stand on kept floor
  expect(shell.has(key(plan.entrance.offset(0, -1, 0)))).toBe(true);
  expect(shell.has(key(plan.exit.offset(0, -1, 0)))).toBe(true);
  // Beyond the exit is the mine's first step: open, not a wall
  const along = plan.exit.minus(plan.exit.offset(0, 0, -1)); // south: +z
  expect(shell.has(key(plan.exit.plus(along)))).toBe(false);
});

test("stair care digs out fallen gravel, never its own paving or anything built", async () => {
  const { fillsStep } = await import(`${ROOT}/src/skills/mine.ts`);
  expect(fillsStep({ name: "gravel", boundingBox: "block" })).toBe(true);
  expect(fillsStep({ name: "stone", boundingBox: "block" })).toBe(true);
  expect(fillsStep({ name: "cobblestone_stairs", boundingBox: "block" })).toBe(false); // its paving
  expect(fillsStep({ name: "oak_planks", boundingBox: "block" })).toBe(false); // built
  expect(fillsStep({ name: "air", boundingBox: "empty" })).toBe(false);
  expect(fillsStep({ name: "torch", boundingBox: "empty" })).toBe(false);
});
