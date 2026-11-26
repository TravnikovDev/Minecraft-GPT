// Phase 7: the diary code writes. One short line per thing worth
// remembering, under the part of the game day it happened in; the same line
// again is counted, not repeated; idle chores and reflexes leave no line.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { partOfDay, withLine, renderDay, linesSince, nextDayCount } = await import(`${ROOT}/src/planner/diary.ts`);
const { taskLine } = await import(`${ROOT}/src/planner/diaryHooks.ts`);

test("parts of the day from the game's time", () => {
  expect([0, 5999, 6000, 12500, 14000, 23999, 24000].map(partOfDay)).toEqual(["morning", "morning", "afternoon", "evening", "night", "night", "morning"]);
});

test("the same line again is counted, a new one is added", () => {
  let day = { day: 3, lines: [] as any[] };
  day = withLine(day, { at: 1, time: "morning", text: "Done: gather wood." });
  day = withLine(day, { at: 2, time: "morning", text: "Done: gather wood." });
  day = withLine(day, { at: 3, time: "afternoon", text: "Reached a milestone: stone tools." });
  expect(day.lines.length).toBe(2);
  expect(renderDay({ ...day, gains: { cobblestone: 30, oak_log: 12 } })).toBe(
    "morning: Done: gather wood. (x2)\nafternoon: Reached a milestone: stone tools.\npicked up today: 30 cobblestone, 12 oak log"
  );
});

test("task outcomes: owner's orders, failures and give-ups make lines; idle chores and reflexes don't", () => {
  expect(taskLine({ name: "gatherWood", bucket: 2 }, "done", "")).toBe("Did what the owner asked: gather wood.");
  expect(taskLine({ name: "homeChores", bucket: 2 }, "failed", "")).toBe("Couldn't finish home chores (the owner's order).");
  expect(taskLine({ name: "milestone: coal", bucket: 5 }, "cancelled", "stuck")).toBe("Gave up on milestone: coal: stuck.");
  expect(taskLine({ name: "night: going to my shelter", bucket: 4 }, "done", "")).toBe("Spent the night in my shelter.");
  expect(taskLine({ name: "milestone: coal", bucket: 5 }, "done", "")).toBeNull(); // written when reached
  expect(taskLine({ name: "tidying up", bucket: 6 }, "done", "")).toBeNull();
  expect(taskLine({ name: "creeper", bucket: 1 }, "done", "")).toBeNull();
});

test("after a summary only the newer lines go to the planner; the day keeps all its lines", () => {
  const day = { day: 5, lines: [{ at: 10, time: "morning", text: "a" }, { at: 20, time: "afternoon", text: "b" }] };
  expect(linesSince(day, 15).lines.map((l: any) => l.text)).toEqual(["b"]);
  expect(day.lines.length).toBe(2);
});

test("its own day count: a new day when the clock comes round to the morning, never from /time set by day or a still clock", () => {
  expect(nextDayCount(4, null, 1000)).toBe(4); // just connected: no day counted
  expect(nextDayCount(4, 23990, 10)).toBe(5); // the night passed
  expect(nextDayCount(4, 13000, 0)).toBe(5); // it slept: the clock jumped to morning
  expect(nextDayCount(4, 6000, 6020)).toBe(4); // the day goes on
  expect(nextDayCount(4, 6000, 1000)).toBe(4); // /time set back in daytime
  expect(nextDayCount(4, 18000, 18000)).toBe(4); // the Nether's clock stands still
});
