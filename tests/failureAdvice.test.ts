// Failure advice and longer memory: what failed today is kept with its exact
// reason and count for the planner, a new plan after a failure comes at once
// and then less and less often while nothing gets done, a job that failed
// three times is off the plan for the day, and the weekly lessons are due
// and tidied as the rules say. No test calls the model (tests/setup.ts).
import { beforeEach, expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { withFailure, blockedGapMs, failureLine, failureKey, isWait, noteFailure, failedToday, failuresToday, takeFreshFailure, noteBlockedPlan, noteProgress, nextBlockedGapMs, resetFailures, MAX_SAME_FAILURES } = await import(`${ROOT}/src/planner/failures.ts`);
const { planningAllowance, planningSpent, PLAN_SHARE } = await import(`${ROOT}/src/planner/cost.ts`);
const { setMilestoneAside } = await import(`${ROOT}/src/planner/names.ts`);
const { lessonsDue, cleanLessons, MAX_LESSONS, LESSONS_EVERY_DAYS, FIRST_LESSONS_AFTER_DAYS, LessonsSchema } = await import(`${ROOT}/src/planner/lessons.ts`);
const { validateSteps } = await import(`${ROOT}/src/planner/plan.ts`);
const { hourlyRoom, PLANS_PER_HOUR } = await import(`${ROOT}/src/planner/planner.ts`);
const { describeGiveUp } = await import(`${ROOT}/src/managers/stuckWatch.ts`);
const { GOALS, goalNamed, worksInTheMine, needsDaylight, deepOreBehind } = await import(`${ROOT}/src/planner/goals.ts`);
const { zodResponsesFunction } = await import("openai/helpers/zod");

beforeEach(() => {
  resetFailures();
  setMilestoneAside(() => false);
});

const failure = (what: string, reason: string, at = 0, wait = false) => ({ key: what, kind: "plan step" as const, what, reason, where: "1, 64, 2", time: "morning", at, wait });

test("the same job failing again is counted, with its newest reason, and moves to the end", () => {
  let list = withFailure([], failure("mining for 10 raw iron", "no path"));
  list = withFailure(list, failure("stocking food", "found no animals"));
  list = withFailure(list, failure("mining for 10 raw iron", "stuck at 3, 40, 9", 5));
  expect(list.map((f: any) => [f.what, f.times, f.reason])).toEqual([
    ["stocking food", 1, "found no animals"],
    ["mining for 10 raw iron", 2, "stuck at 3, 40, 9"],
  ]);
});

test("a job is known by its goal and what it's for, never its count or wording", () => {
  expect(failureKey("mineFor", { item: "raw_iron", count: 10 })).toBe("mineFor:raw_iron");
  expect(failureKey("mineFor", { item: "raw_iron", count: 8 })).toBe("mineFor:raw_iron");
  expect(failureKey("reachMilestone", { milestone: "iron" })).toBe("reachMilestone:iron");
  expect(failureKey("hunt", { animal: "cow", count: 3 })).toBe("hunt:cow");
  expect(failureKey("stockFood", {})).toBe("stockFood");
  expect(failureKey("gatherWood", { count: 16 })).toBe("gatherWood");
});

test("a wait (hurt, hungry, refused at night) is written down but is no strike against the job", () => {
  expect(isWait({ reason: "refused", unfit: false, workingTime: false })).toBe(true); // "the trees wait for the morning"
  expect(isWait({ reason: "refused", unfit: false, workingTime: true })).toBe(false); // the server said no, by day: a real failure
  expect(isWait({ reason: "unreachable", unfit: true, workingTime: true })).toBe(true); // hurt: whatever it says
  expect(isWait({ reason: "unreachable", unfit: false, workingTime: true })).toBe(false);
  for (let i = 0; i < 5; i++) noteFailure("plan step", "mineFor:raw_iron", "mining for 10 raw iron", "I'm hurt (health 6 of 20); healing before I go down the mine", true);
  expect(failedToday("mineFor:raw_iron").times).toBe(0);
  expect(failuresToday()[0].times).toBe(5);
  expect(failureLine(failuresToday()[0])).toContain("a wait, not a failure of the job");
});

test("a failure reads as one line: what, the exact reason, where, when, how often", () => {
  const line = failureLine({ ...failure("mining for 10 raw iron", "I can't find a way there (no path)", 0), times: 2, strikes: 2 }, 3 * 60_000);
  expect(line).toBe('plan step "mining for 10 raw iron": I can\'t find a way there (no path) (at 1, 64, 2, in the morning, 3 min ago; failed 2 times today)');
  expect(failureLine({ ...failure("stocking food", "found no animals", 1000), times: 1, strikes: 1 }, 1000)).toContain("just now)");
});

test("a new plan after a failure: at once, then 1, 2, 4... up to 15 minutes while nothing gets done", () => {
  expect([0, 1, 2, 3, 4, 5, 9].map((n) => blockedGapMs(n) / 60_000)).toEqual([0, 1, 2, 4, 8, 15, 15]);
  expect(nextBlockedGapMs()).toBe(0);
  noteBlockedPlan();
  noteBlockedPlan();
  expect(nextBlockedGapMs()).toBe(2 * 60_000);
  noteProgress(); // something got done: the next failure is thought over at once again
  expect(nextBlockedGapMs()).toBe(0);
});

test("the newest failure is handed to the next plan once; the day's list keeps it", () => {
  noteFailure("milestone", "reachMilestone:iron", "iron", "I can't find a way there (no path)");
  expect(takeFreshFailure()?.what).toBe("iron");
  expect(takeFreshFailure()).toBeNull();
  expect(failuresToday().length).toBe(1);
  expect(failedToday("reachMilestone:iron")).toEqual({ times: 1, reason: "I can't find a way there (no path)" });
  // One no plan took up for minutes is no longer "what just went wrong"
  noteFailure("milestone", "reachMilestone:iron", "iron", "I can't find a way there (no path)");
  expect(takeFreshFailure(Date.now() + 6 * 60_000)).toBeNull();
});

test("a step that failed three times today is left out of a plan, with why", () => {
  const step = { goal: "stockFood", milestone: null, item: null, count: null, lookFor: null, animal: null, why: "hungry" };
  for (let i = 0; i < MAX_SAME_FAILURES - 1; i++) noteFailure("plan step", "stockFood", "stocking food", "found no animals");
  expect(validateSteps([step], undefined, () => []).accepted.map((s: any) => s.goal)).toEqual(["stockFood"]);
  noteFailure("plan step", "stockFood", "stocking food", "found no animals");
  const { accepted, rejected } = validateSteps([step], undefined, () => []);
  expect(accepted).toEqual([]);
  expect(rejected[0].why).toBe("it failed 3 times today (found no animals); tomorrow again");
});

test("another count is the same job: wood that failed three times at 16 logs is off at 8 too", () => {
  const wood = (count: number) => ({ goal: "gatherWood", milestone: null, item: null, count, lookFor: null, animal: null, why: "wood" });
  for (let i = 0; i < MAX_SAME_FAILURES; i++) noteFailure("plan step", failureKey("gatherWood", { count: 16 }), "chopping 16 logs", "found no trees");
  const { accepted, rejected } = validateSteps([wood(8)], undefined, () => []);
  expect(accepted).toEqual([]);
  expect(rejected[0].why).toContain("it failed 3 times today");
});

test("a short plan is never topped up with a milestone that failed three times today or that is set aside", () => {
  const always = () => ({ ok: true as const });
  const open = () => ["coal", "iron", "torches", "bridge"];
  // The milestone failing as code's own fallback counts under the plan step's name
  for (let i = 0; i < MAX_SAME_FAILURES; i++) noteFailure("milestone", failureKey("reachMilestone", { milestone: "coal" }), "coal", "found no coal");
  setMilestoneAside((id: string) => id === "iron");
  const { accepted } = validateSteps([], always, open);
  expect(accepted.map((s: any) => s.args.milestone)).toEqual(["torches", "bridge"]);
});

test("its own planning is paced over the month: its share of the cap, a day's worth at a time", () => {
  const at = (day: number): number => Date.UTC(2026, 10, day, 12); // November: 30 days
  expect(planningAllowance(10, at(1))).toBeCloseTo((10 * PLAN_SHARE) / 30, 6);
  expect(planningAllowance(10, at(15))).toBeCloseTo(10 * PLAN_SHARE * 0.5, 6);
  expect(planningAllowance(10, at(30))).toBeCloseTo(10 * PLAN_SHARE, 6); // never the chat's share
  expect(planningSpent({ month: "2026-11", calls: 3, inputTokens: 0, outputTokens: 0, usd: 1, byPurpose: { plan: 0.4, lessons: 0.1, chat: 0.5 } })).toBeCloseTo(0.5, 6);
});

test("deep ores, and what's smelted from them, are known as deep", () => {
  expect(["raw_gold", "gold_ingot", "redstone", "diamond", "iron_ingot", "raw_copper", "flint"].map(deepOreBehind)).toEqual(["raw_gold", "raw_gold", "redstone", "diamond", null, null, null]);
});

test("its own plans stop at 20 in an hour; older ones no longer count", () => {
  const now = 10 * 60 * 60_000;
  const busy = Array.from({ length: PLANS_PER_HOUR }, (_, i) => now - i * 60_000);
  expect(hourlyRoom(busy, now).room).toBe(false);
  expect(hourlyRoom(busy, now + 41 * 60_000).room).toBe(true); // the oldest went out of the hour
  expect(hourlyRoom([now - 61 * 60_000], now).kept).toEqual([]);
});

test("giving up as stuck says where it stood and where it was going", () => {
  expect(describeGiveUp({ task: "plan: x", at: 0, where: { x: 10.5, y: 64, z: -2.5 }, goal: { x: 40, y: 12, z: 8 } })).toContain("stuck at 10, 64, -3 on the way to 40, 12, 8");
  expect(describeGiveUp({ task: "plan: x", at: 0, where: { x: 1, y: 2, z: 3 }, goal: null })).toContain("stuck at 1, 2, 3, not walking anywhere");
});

test("lessons: first once three days are summarised, then every game week", () => {
  expect(lessonsDue(2, null, FIRST_LESSONS_AFTER_DAYS - 1)).toBe(false);
  expect(lessonsDue(3, null, FIRST_LESSONS_AFTER_DAYS)).toBe(true);
  expect(lessonsDue(9, 3, 30)).toBe(false);
  expect(lessonsDue(3 + LESSONS_EVERY_DAYS, 3, 30)).toBe(true);
});

test("lessons are tidied: trimmed, no empty or repeated ones, cut to a sentence, at most 12", () => {
  const cleaned = cleanLessons(["  Sheep are east of home.  ", "", "sheep are east of home.", "x".repeat(300), ...Array.from({ length: 20 }, (_, i) => `Lesson ${i}`)]);
  expect(cleaned[0]).toBe("Sheep are east of home.");
  expect(cleaned[1].length).toBe(200);
  expect(cleaned[1].endsWith("...")).toBe(true);
  expect(cleaned.length).toBe(MAX_LESSONS);
  const tool = zodResponsesFunction({ name: "submitLessons", description: "lessons", parameters: LessonsSchema });
  expect(tool.strict).toBe(true);
});

test("the wider goal menu: fields, fishing, hunting, collecting and mending the mine, each a strict goal", () => {
  const names = GOALS.map((g: any) => g.name);
  expect(names).toEqual(expect.arrayContaining(["tendFarm", "goFishing", "hunt", "collect", "mendMine"]));
  expect(new Set(names).size).toBe(names.length);
  // Mine work runs at night and doesn't climb out first
  expect(["mineFor", "mendMine", "collect", "hunt"].map(worksInTheMine)).toEqual([true, true, false, false]);
  // Fishing waits for daylight; a hunt and fishing are checked where it stands when the step starts
  expect(["goFishing", "hunt", "mineFor"].map(needsDaylight)).toEqual([true, false, false]);
  expect(["hunt", "goFishing", "mendMine"].every((n) => typeof goalNamed(n).ready === "function")).toBe(true);
  const always = () => ({ ok: true as const });
  const step = (goal: string, extra: Record<string, unknown> = {}) => ({ goal, milestone: null, item: null, count: null, lookFor: null, animal: null, why: "because", ...extra });
  const { accepted, rejected } = validateSteps(
    [step("hunt", { animal: "cow" }), step("collect", { item: "flint" }), step("hunt", { animal: "dragon" }), step("tendFarm"), step("goFishing"), step("mendMine")],
    always,
    () => []
  );
  expect(accepted.map((s: any) => [s.goal, s.args])).toEqual([
    ["hunt", { animal: "cow", count: 3 }],
    ["collect", { item: "flint", count: 4 }],
    ["tendFarm", {}],
    ["goFishing", {}],
    ["mendMine", {}],
  ]);
  expect(rejected.map((r: any) => r.step)).toEqual(["hunt dragon"]);
  expect(goalNamed("hunt").describe({ animal: "cow", count: 3 })).toBe("hunting cow (up to 3)");
});
