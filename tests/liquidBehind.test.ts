// Path: tests/liquidBehind.test.ts
// Never a block with water or lava behind it (owner: its own way dug through
// a flooded cave let the water in).
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { liquidBehind } = await import(`${ROOT}/src/core/movements.ts`);

test("water at a side or on top: not broken; water under it or nowhere near: fine", () => {
  const at = { x: 0, y: 10, z: 0 };
  const only = (wx: number, wy: number, wz: number, name = "water") => (x: number, y: number, z: number) => (x === wx && y === wy && z === wz ? name : "stone");
  expect(liquidBehind(at, only(1, 10, 0))).toBe(true);
  expect(liquidBehind(at, only(0, 11, 0, "lava"))).toBe(true);
  expect(liquidBehind(at, only(0, 9, 0))).toBe(false); // below: it doesn't come up
  expect(liquidBehind(at, () => "stone")).toBe(false);
});
