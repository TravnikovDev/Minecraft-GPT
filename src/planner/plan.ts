// Path: src/planner/plan.ts
// The day plan (Phase 7): its strict schema (what the model must answer),
// the validator (every plan is untrusted input), and the plan store in world
// memory that the curriculum runs in bucket B5, one step at a time.

import { z } from "zod";
import { getMemory, updateMemory } from "../managers/persistenceManager";
import { failedToday, failureKey, struckOut } from "./failures";
import { milestoneSetAside } from "./names";
import { GAME_ANIMAL_NAMES, GOALS, goalNamed, openMilestones, policy, type Feasible } from "./goals";

/** The step count the plan must have, enforced in code (the model gave 2 when asked for 3-5). */
export const MIN_STEPS = 3;
export const MAX_STEPS = 8;

// One flat step: the goal and every goal's arguments, null when not used
// (strict tools want every field present; the validator picks the goal's own)
export const StepSchema = z.object({
  goal: z.enum(GOALS.map((g) => g.name) as [string, ...string[]]),
  milestone: z.string().nullable().describe("reachMilestone: the milestone id"),
  item: z.string().nullable().describe("mineFor, craft or collect: the exact Minecraft item id"),
  count: z.number().int().nullable().describe("gatherWood, mineFor, craft, collect, hunt: how many"),
  lookFor: z.enum(["animals", "sheep"]).nullable().describe("explore: what to look for"),
  animal: z.enum(GAME_ANIMAL_NAMES).nullable().describe("hunt: which animal"),
  why: z.string().describe("one short reason, in character"),
});
export type RawStep = z.infer<typeof StepSchema>;

export const DayPlanSchema = z.object({
  narrative: z.string().describe("one or two sentences in character: what you'll do and why"),
  steps: z.array(StepSchema).describe(`${MIN_STEPS} to ${MAX_STEPS} goals, in the order to do them`),
  daySummary: z.string().describe("the whole of today so far, in 2-4 sentences, for your long-term memory (update today's earlier summary if one is given)"),
  ownerMessage: z.string().nullable().describe("a short piece of news or a suggestion for the owner when they're online (never a question: you decide yourself), else null"),
});
export type DayPlan = z.infer<typeof DayPlanSchema>;

export type PlanStep = { goal: string; args: Record<string, unknown>; why: string; status: "pending" | "running" | "done" | "failed" | "skipped"; reason?: string };
export type StoredPlan = { id?: number; madeAt: number; day: number; narrative: string; steps: PlanStep[] };

/** A plan's identity (older plans have none: their time made). */
export const planIdOf = (plan: StoredPlan): number => plan.id ?? plan.madeAt;

/** The id of the plan it's following now, or null. */
export const currentPlanId = (): number | null => {
  const plan = currentPlan();
  return plan ? planIdOf(plan) : null;
};

/**
 * A step's status once it ran: done, failed (an error, stuck, too long, a
 * failed result), or pending again when something else cut it off (it goes
 * on later). Pure.
 */
export function stepStatusAfter(r: { threw: boolean; cancelled: boolean; reason: string; ok: boolean }): "done" | "failed" | "pending" {
  if (r.threw) return "failed";
  if (r.cancelled) return r.reason === "stuck" || r.reason === "took too long" ? "failed" : "pending";
  return r.ok ? "done" : "failed";
}

/** The goal's own arguments out of a flat step ({goal: "mineFor", item, count}). */
function argsFor(step: RawStep): Record<string, unknown> {
  const goal = goalNamed(step.goal);
  if (!goal) return {};
  const all = step as unknown as Record<string, unknown>;
  // Left out (null): the goal's default, if it has one ("mineFor raw_iron" means 10)
  return Object.fromEntries(Object.keys(goal.args.shape).map((k) => [k, all[k] ?? goal.defaults?.[k] ?? all[k]]));
}

/**
 * The plan's steps checked one by one: a known goal, its arguments valid,
 * possible now, not the same as an earlier step. At most MAX_STEPS are kept;
 * fewer than MIN_STEPS are topped up with the next open milestones (the
 * fallback plan). Rejected steps keep their reason for the diary.
 * `feasible` is injectable for tests.
 */
export function validateSteps(
  raw: RawStep[],
  // Possible now, and allowed (the policy: keep-out areas)
  feasible: (goal: string, args: Record<string, unknown>) => Feasible = (goal, args) => {
    const allowed = policy(goal, args);
    if (!allowed.ok) return allowed;
    const g = goalNamed(goal);
    if (!g) return { ok: false, why: "unknown goal" };
    // Failed again and again today: not today any more, whatever the model
    // says and whatever count it asks for this time (the job, not its wording)
    const key = failureKey(goal, args);
    if (struckOut(key)) {
      const failed = failedToday(key);
      return { ok: false, why: `it failed ${failed.times} times today (${failed.reason}); tomorrow again` };
    }
    return g.feasible(args);
  },
  open: () => string[] = openMilestones
): { accepted: PlanStep[]; rejected: { step: string; why: string }[] } {
  const accepted: PlanStep[] = [];
  const rejected: { step: string; why: string }[] = [];
  const seen = new Set<string>();
  for (const step of raw) {
    const goal = goalNamed(step.goal);
    const label = `${step.goal}${step.milestone ? ` ${step.milestone}` : ""}${step.item ? ` ${step.item}` : ""}${step.animal ? ` ${step.animal}` : ""}`;
    if (!goal) {
      rejected.push({ step: label, why: "not a goal it knows" });
      continue;
    }
    const parsed = goal.args.safeParse(argsFor(step));
    if (!parsed.success) {
      rejected.push({ step: label, why: `bad arguments (${parsed.error.issues.map((i) => i.path.join(".") || i.message).join(", ")})` });
      continue;
    }
    const args = parsed.data as Record<string, unknown>;
    const key = `${step.goal}:${JSON.stringify(args)}`;
    if (seen.has(key)) continue; // the same step twice: once is enough
    const can = feasible(step.goal, args);
    if (!can.ok) {
      rejected.push({ step: label, why: can.why });
      continue;
    }
    if (accepted.length >= MAX_STEPS) {
      rejected.push({ step: label, why: `more than ${MAX_STEPS} steps` });
      continue;
    }
    seen.add(key);
    accepted.push({ goal: step.goal, args, why: step.why, status: "pending" });
  }
  // Too short: the next open milestones fill it up (code's own plan), but
  // never one that failed too often today or that the curriculum has set
  // aside after a failure (review: the top-up put the failing milestone
  // straight back in, past both)
  for (const id of open()) {
    if (accepted.length >= MIN_STEPS) break;
    const key = `reachMilestone:${JSON.stringify({ milestone: id })}`;
    if (seen.has(key)) continue;
    if (struckOut(failureKey("reachMilestone", { milestone: id })) || milestoneSetAside(id)) continue;
    seen.add(key);
    accepted.push({ goal: "reachMilestone", args: { milestone: id }, why: "next on my list", status: "pending" });
  }
  return { accepted, rejected };
}

// --- The plan store (world memory) --------------------------------------------

/** The plan it's following, if any. */
export function currentPlan(): StoredPlan | null {
  return (getMemory().plan as StoredPlan | undefined) ?? null;
}

/** Saves a new plan (replacing the old one). */
export async function savePlan(plan: StoredPlan): Promise<void> {
  await updateMemory({ plan });
}

/** The next step to do, with its index ("running" is never next: one is running already). */
export function nextStep(plan: StoredPlan | null = currentPlan()): { planId: number; index: number; step: PlanStep } | null {
  if (!plan) return null;
  const index = plan.steps.findIndex((s) => s.status === "pending");
  return index >= 0 ? { planId: planIdOf(plan), index, step: plan.steps[index]! } : null;
}

/** After a restart nothing is running: a step left "running" is to do again. */
export async function resetRunningSteps(): Promise<void> {
  const plan = currentPlan();
  if (!plan || !plan.steps.some((s) => s.status === "running")) return;
  await savePlan({ ...plan, steps: plan.steps.map((s) => (s.status === "running" ? { ...s, status: "pending" } : s)) });
}

/** Marks a step of plan `planId` (nothing when that plan was replaced meanwhile). */
export async function markStep(planId: number, index: number, status: PlanStep["status"], reason?: string): Promise<void> {
  const plan = currentPlan();
  const step = plan?.steps[index];
  if (!plan || !step || planIdOf(plan) !== planId) return;
  const steps = plan.steps.map((s, i) => (i === index ? { ...s, status, ...(reason ? { reason } : {}) } : s));
  await savePlan({ ...plan, steps });
}

/**
 * A step of an earlier plan finished just now, after a newer plan was made
 * (the running step is let finish): when the newer plan's next step is that
 * same step, with the same arguments, it's done already and isn't run again.
 * True when it marked one.
 */
export async function markDoneIfNext(goal: string, args: Record<string, unknown>): Promise<boolean> {
  const next = nextStep();
  if (!next || next.step.goal !== goal || JSON.stringify(next.step.args) !== JSON.stringify(args)) return false;
  await markStep(next.planId, next.index, "done");
  return true;
}

/** The plan as one chat line: "Today: coal, then iron tools (2 of 4 done)." */
export function describePlan(plan: StoredPlan | null = currentPlan()): string {
  if (!plan) return "I don't have a plan yet.";
  const label = (s: PlanStep): string => goalNamed(s.goal)?.describe(s.args) ?? s.goal;
  const done = plan.steps.filter((s) => s.status === "done").length;
  const left = plan.steps.filter((s) => s.status === "pending" || s.status === "running");
  if (left.length === 0) return `My plan for day ${plan.day} is finished (${done} of ${plan.steps.length} done).`;
  return `${plan.narrative} Next: ${left.map(label).join(", then ")} (${done} of ${plan.steps.length} done).`;
}
