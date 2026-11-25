// Path: src/planner/runner.ts
// Runs the day plan (Phase 7) in bucket B5, one step at a time: each step is
// checked again when it starts (a plan made at dusk can be stale by noon),
// its outcome goes in the diary, and two failures in a row ask for a new
// plan. Owner commands and reflexes cut in as usual; a step cut off goes on
// later. Without a plan (not made yet, the model unavailable, the money
// spent) the curriculum's next milestone is the fallback.

import { Bucket, type TaskSpec } from "../core/arbiter";
import { currentSignal, isCommandCancelled } from "../core/commandContext";
import { on } from "../core/events";
import { describeFailure } from "../core/result";
import { note } from "./diary";
import { goalNamed } from "./goals";
import { failuresInARow, markStep, type PlanStep } from "./plan";

// Long goals (a milestone, a mining trip) get as long as a milestone task
const STEP_MAX_MS = 15 * 60_000;
export const PLAN_PREFIX = "plan: ";

let registered = false;
let autonomyCheck: () => boolean = () => false;
let planAgain: (why: "blocked" | "death") => void = () => {};

/** The task for one plan step (resumed after a cut-in while it's still wanted). */
export function planStepTask(index: number, step: PlanStep): TaskSpec | null {
  const goal = goalNamed(step.goal);
  if (!goal) return null;
  const what = goal.describe(step.args);
  return {
    name: `${PLAN_PREFIX}${what}`,
    bucket: Bucket.Self,
    maxMs: STEP_MAX_MS,
    run: async () => {
      const can = goal.feasible(step.args);
      if (!can.ok) {
        await markStep(index, "skipped", can.why);
        await note(`Skipped ${what} from my plan: ${can.why}.`);
        return;
      }
      await markStep(index, "running");
      const result = await goal.run(step.args);
      if (isCommandCancelled()) {
        const why = String(currentSignal()?.reason ?? "");
        // Stuck or too long: that's a failure; cut off by something else: later
        if (why === "stuck" || why === "took too long") {
          await markStep(index, "failed", why);
          await note(`Gave up on ${what}: ${why}.`);
          if (failuresInARow() >= 2) planAgain("blocked");
        } else {
          await markStep(index, "pending");
        }
        return;
      }
      if (result.ok) {
        await markStep(index, "done");
        await note(`Done from my plan: ${what}.`);
        return;
      }
      const why = describeFailure(result);
      await markStep(index, "failed", why);
      await note(`Couldn't do ${what}: ${why}.`);
      if (failuresInARow() >= 2) planAgain("blocked");
    },
    resume: () => (autonomyCheck() ? planStepTask(index, step) : null),
  };
}

/**
 * Wires the runner's triggers once: a death asks for a new plan; `again`
 * makes one (the planner), `autonomy` says whether it lives its own life.
 */
export function registerPlanRunner(autonomy: () => boolean, again: (why: "blocked" | "death") => void): void {
  autonomyCheck = autonomy;
  planAgain = again;
  if (registered) return;
  registered = true;
  on("bot:died", () => {
    if (autonomyCheck()) planAgain("death");
  });
}
