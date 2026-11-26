// Path: src/planner/runner.ts
// Runs the day plan (Phase 7) in bucket B5, one step at a time: each step is
// checked again when it starts (a plan made at dusk can be stale by noon),
// its outcome goes in the diary, and two failures in a row ask for a new
// plan. Owner commands and reflexes cut in as usual; a step cut off goes on
// later. A step belongs to one plan: once that plan is replaced it is never
// run or marked again. Without a plan step the curriculum's next milestone
// is the fallback.

import { Bucket, type TaskSpec } from "../core/arbiter";
import { currentSignal, isCommandCancelled } from "../core/commandContext";
import { on } from "../core/events";
import { describeFailure, type ActionResult } from "../core/result";
import { note } from "./diary";
import { goalNamed } from "./goals";
import { PLAN_PREFIX, stepAllowedNow } from "./names";
import { currentPlan, currentPlanId, failuresInARow, markStep, stepStatusAfter } from "./plan";

// Long goals (a milestone, a mining trip) get as long as a milestone task
const STEP_MAX_MS = 15 * 60_000;

let registered = false;
let autonomyCheck: () => boolean = () => false;
let planAgain: (why: "blocked" | "death") => void = () => {};

/** The task for step `index` of plan `planId`; null when that plan or step is gone. */
export function planStepTask(planId: number, index: number): TaskSpec | null {
  const plan = currentPlan();
  const step = plan?.steps[index];
  const goal = step ? goalNamed(step.goal) : undefined;
  if (!plan || !step || !goal || currentPlanId() !== planId) return null;
  const what = goal.describe(step.args);
  return {
    name: `${PLAN_PREFIX}${what}`,
    bucket: Bucket.Self,
    maxMs: STEP_MAX_MS,
    run: async () => {
      if (currentPlanId() !== planId) return; // replaced while it waited
      const can = goal.feasible(step.args);
      if (!can.ok) {
        await markStep(planId, index, "skipped", can.why);
        await note(`Skipped ${what} from my plan: ${can.why}.`);
        return;
      }
      await markStep(planId, index, "running");
      let result: ActionResult | null = null;
      let threw = false;
      try {
        result = await goal.run(step.args);
      } catch (error) {
        threw = true;
        console.error(`Plan step "${what}" went wrong:`, error);
      }
      const cancelled = isCommandCancelled();
      const reason = String(currentSignal()?.reason ?? "");
      const status = stepStatusAfter({ threw, cancelled, reason, ok: result?.ok ?? false });
      const why = threw ? "something went wrong" : cancelled ? reason : result && !result.ok ? describeFailure(result) : "";
      await markStep(planId, index, status, status === "failed" ? why : undefined);
      if (currentPlanId() !== planId) return; // a new plan came while it worked: nothing to write here
      if (status === "done") await note(`Done from my plan: ${what}.`);
      if (status === "failed") {
        await note(`${cancelled ? "Gave up on" : "Couldn't do"} ${what}: ${why}.`);
        if (failuresInARow() >= 2) planAgain("blocked");
      }
    },
    // After a cut-in: on with it, if it's still the plan, still wanted and allowed now (night)
    resume: () => (autonomyCheck() && currentPlanId() === planId && stepAllowedNow(step) ? planStepTask(planId, index) : null),
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

export { PLAN_PREFIX };
