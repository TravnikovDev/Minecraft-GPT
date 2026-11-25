// Phase 7: the day plan is untrusted input. Each step must be a known goal
// with valid arguments, possible now, and not a repeat; at most 8 are kept,
// fewer than 3 are topped up with the next open milestones (code's own plan).
import { expect, test } from "bun:test";
import { zodResponsesFunction } from "openai/helpers/zod";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { validateSteps, DayPlanSchema, MAX_STEPS, describePlan } = await import(`${ROOT}/src/planner/plan.ts`);

const step = (goal: string, extra: Record<string, unknown> = {}) => ({ goal, milestone: null, item: null, count: null, lookFor: null, why: "because", ...extra });
const always = () => ({ ok: true as const });
const none = () => [] as string[];

test("known goals with valid arguments are kept, in order, with their own arguments only", () => {
  const { accepted, rejected } = validateSteps(
    [step("mineFor", { item: "raw_iron", count: 10, milestone: "coal" }), step("stockFood"), step("gatherWood", { count: 16 })],
    always,
    none
  );
  expect(rejected).toEqual([]);
  expect(accepted.map((s: any) => s.goal)).toEqual(["mineFor", "stockFood", "gatherWood"]);
  expect(accepted[0].args).toEqual({ item: "raw_iron", count: 10 }); // the stray milestone dropped
  expect(accepted[0].status).toBe("pending");
});

test("an argument the model left out gets the goal's default (it often leaves counts out)", () => {
  const { accepted, rejected } = validateSteps([step("mineFor", { item: "raw_iron" }), step("explore"), step("gatherWood")], always, none);
  expect(rejected).toEqual([]);
  expect(accepted.map((s: any) => s.args)).toEqual([{ item: "raw_iron", count: 10 }, { lookFor: "animals" }, { count: 16 }]);
});

test("unknown goals, bad arguments and impossible steps are rejected with a reason", () => {
  const feasible = (goal: string) => (goal === "plantTrees" ? { ok: false as const, why: "it carries no saplings" } : { ok: true as const });
  const { accepted, rejected } = validateSteps(
    [step("flyToTheMoon"), step("mineFor", { item: null }), step("plantTrees"), step("stockFood"), step("restAndRepair"), step("stockFood")],
    feasible,
    none
  );
  expect(rejected.map((r: any) => r.why)).toEqual(["not a goal it knows", expect.stringContaining("bad arguments"), "it carries no saplings"]);
  expect(accepted.map((s: any) => s.goal)).toEqual(["stockFood", "restAndRepair"]); // the repeat dropped
});

test("never more than 8 steps; fewer than 3 are topped up with the next open milestones", () => {
  const many = Array.from({ length: 12 }, (_, i) => step("gatherWood", { count: 4 + i }));
  const long = validateSteps(many, always, none);
  expect(long.accepted.length).toBe(MAX_STEPS);
  const short = validateSteps([step("reachMilestone", { milestone: "coal" })], always, () => ["coal", "iron", "iron_pickaxe"]);
  expect(short.accepted.map((s: any) => s.args.milestone ?? s.goal)).toEqual(["coal", "iron", "iron_pickaxe"]);
  expect(short.accepted[1].why).toBe("next on my list");
});

test("the plan schema is a valid strict tool for the Responses API", () => {
  const tool = zodResponsesFunction({ name: "submitDayPlan", description: "plan", parameters: DayPlanSchema });
  expect(tool.strict).toBe(true);
  expect(tool.name).toBe("submitDayPlan");
  const params = tool.parameters as any;
  expect(params.required).toEqual(expect.arrayContaining(["narrative", "steps", "daySummary", "ownerMessage"]));
});

test("the plan in chat: what's next and how far it got", () => {
  const plan = {
    madeAt: 0,
    day: 4,
    narrative: "Iron day!",
    steps: [
      { goal: "stockFood", args: {}, why: "", status: "done" },
      { goal: "gatherWood", args: { count: 8 }, why: "", status: "pending" },
    ],
  };
  expect(describePlan(plan)).toBe("Iron day! Next: chopping 8 logs (1 of 2 done).");
});
