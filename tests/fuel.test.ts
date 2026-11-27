// What its furnaces burn (owner, 2026-11-28: planks are fine when there's a
// lot of wood in its bag or its chests; the coal is kept for torches).
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
useFakeBot({});
const ROOT = `${import.meta.dir}/..`;
const { spareWood, woodPlenty, fuelOrder, WOOD_PLENTY } = await import(`${ROOT}/src/actions/fuel.ts`);

test("spare wood: its 20-log stock doesn't count; carried planks, logs past the stock and what its chests hold do (a log is 4 planks)", () => {
  expect(spareWood({ planks: 0, logs: 20, storedPlanks: 0, storedLogs: 0 })).toBe(0);
  expect(spareWood({ planks: 8, logs: 24, storedPlanks: 4, storedLogs: 10 })).toBe(8 + 16 + 4 + 40);
});

test("a lot of wood: planks burn first and the coal waits; otherwise coal, charcoal, then planks and logs", () => {
  expect(WOOD_PLENTY).toBe(64);
  expect(woodPlenty({ planks: 0, logs: 20, storedPlanks: 0, storedLogs: 16 })).toBe(true); // 64 planks' worth in its chests
  expect(woodPlenty({ planks: 10, logs: 20, storedPlanks: 0, storedLogs: 5 })).toBe(false);
  expect(fuelOrder(true)[0]).toBe("planks");
  expect(fuelOrder(false)).toEqual(["coal", "charcoal", "planks", "logs"]);
});
