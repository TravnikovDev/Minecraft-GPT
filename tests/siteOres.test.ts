// Its home placed for its mine's ore (owner, 2026-11-28: "5 blocks further it
// would get more ore; the mine's sleeves and pokeholes should touch the most
// resources: it must look like luck, but be the result of deep analysis").
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
useFakeBot({});
const ROOT = `${import.meta.dir}/..`;
const { oreValue, oreWorth, planTouch } = await import(`${ROOT}/src/skills/siteOres.ts`);
const { floorCells, hubStep, stepAt, dirAt, ARM_LENGTH } = await import(`${ROOT}/src/skills/mine.ts`);

test("ore worth: diamonds most, copper least, stone nothing", () => {
  expect(oreWorth("deepslate_diamond_ore")).toBe(10);
  expect(oreWorth("iron_ore")).toBe(4);
  expect(oreWorth("deepslate_copper_ore")).toBe(1);
  expect(oreWorth("stone")).toBe(0);
});

test("a site is worth the ore its mine's plan would uncover: in a tunnel or against its wall, on any floor", () => {
  const exit = { x: 100, y: 64, z: 100 };
  // A cell of the 1st floor's sleeves, far out, and one of the 3rd floor's
  const cells1 = floorCells(stepAt(exit, "south", hubStep(0)), dirAt("south", hubStep(0)), 0);
  const cells3 = floorCells(stepAt(exit, "south", hubStep(2)), dirAt("south", hubStep(2)), 2);
  const far = cells1[cells1.length - 1];
  const deep = cells3.reduce((a: { y: number }, b: { y: number }) => (b.y > a.y ? b : a)); // a 3-high column's top cell
  const ores = [
    { x: far.x, y: far.y, z: far.z, worth: 4 }, // iron in a tunnel cell
    { x: deep.x, y: deep.y + 1, z: deep.z, worth: 10 }, // a diamond right over it: against its roof
    { x: exit.x + 200, y: 20, z: exit.z, worth: 10 }, // nowhere near
  ];
  const v = oreValue(exit, "south", ores);
  expect(v.count).toBe(2);
  expect(v.worth).toBe(14);
  // The same ore from a spot 5 blocks along: the plan moves with it, the tunnels miss some
  const moved = oreValue({ ...exit, x: exit.x + 5 }, "south", ores);
  expect(moved.worth).toBeLessThan(v.worth);
  expect(planTouch("south").size).toBeGreaterThan(ARM_LENGTH * 4 * 3);
});

test("underground first, then the most ore (owner: both, an underground shelter plus the most ore in its tunnels)", async () => {
  const { pickOrder, BURIED_GAPS } = await import(`${ROOT}/src/actions/building.ts`);
  expect(BURIED_GAPS).toBe(3);
  const buried = [
    { id: "a", gaps: 0, worth: 900 },
    { id: "b", gaps: 2, worth: 1400 },
    { id: "c", gaps: 0, worth: 1400 },
  ];
  // A slope spot with far more ore still comes after every buried one
  const rest = [{ id: "slope", gaps: 52, worth: 0 }];
  expect(pickOrder(buried, rest).map((c: { id: string }) => c.id)).toEqual(["c", "b", "a", "slope"]);
});
