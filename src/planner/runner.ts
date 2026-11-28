// Path: src/planner/runner.ts
// Runs the day plan (Phase 7) in bucket B5, one step at a time: each step is
// checked again when it starts (a plan made at dusk can be stale by noon),
// its outcome goes in the diary, and a failure asks for a new plan at once,
// with its exact reason (planner/failures), so the model decides what to do
// about it. Owner commands and reflexes cut in as usual; a step cut off goes on
// later. A step belongs to one plan: once that plan is replaced it is never
// run or marked again. Without a plan step the curriculum's next milestone
// is the fallback.

import { Bucket, type TaskSpec } from "../core/arbiter";
import { currentSignal, isCommandCancelled } from "../core/commandContext";
import { on } from "../core/events";
import { describeFailure, type ActionResult } from "../core/result";
import { note } from "./diary";
import { failureKey, isWait, noteFailure, noteProgress } from "./failures";
import { goalNamed, policy, worksInTheMine } from "./goals";
import { PLAN_PREFIX, stepAllowedNow } from "./names";
import { currentPlan, currentPlanId, markStep, stepStatusAfter } from "./plan";

// A give-up by the stuck watcher this recent is this step's
const GIVE_UP_FRESH_MS = 30_000;

/** True when a failed result was a wait (hurt, too hungry, refused outside working time), as things stand now. */
async function waitNotFailure(reason: string): Promise<boolean> {
  const { bot } = await import("../core/body");
  const { foodPoints } = await import("../skills/capabilities");
  const { fitForTheMine } = await import("../skills/mine");
  const { workingTime } = await import("../core/daylight");
  return isWait({ reason, unfit: !fitForTheMine(bot.health ?? 20, foodPoints()).ok, workingTime: workingTime() });
}

/** Why a step cut off as stuck stopped: where it stood and where it was going, when the watcher said. */
async function stuckReason(): Promise<string> {
  const { lastGiveUp, describeGiveUp } = await import("../managers/stuckWatch");
  const g = lastGiveUp();
  return g && Date.now() - g.at < GIVE_UP_FRESH_MS ? describeGiveUp(g) : "stuck";
}

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
      const allowed = policy(step.goal, step.args);
      const can = allowed.ok ? goal.feasible(step.args) : allowed;
      if (!can.ok) {
        await markStep(planId, index, "skipped", can.why);
        await note(`Skipped ${what} from my plan: ${can.why}.`);
        return;
      }
      await markStep(planId, index, "running");
      let result: ActionResult | null = null;
      let threw = false;
      try {
        // Anything but mine work starts out of its mine by its own stairs
        const mineWork = worksInTheMine(step.goal) || (step.goal === "reachMilestone" && (await import("../skills/curriculum")).worksAtNight(String(step.args["milestone"])));
        if (!mineWork) await (await import("../skills/mine")).upFromTheMine();
        // Ready right here (animals known, water in reach, fit for the mine)?
        // If not, skipped with why: no failure, no new plan
        const ready = goal.ready?.(step.args) ?? { ok: true as const };
        if (!ready.ok && !isCommandCancelled()) {
          await markStep(planId, index, "skipped", ready.why);
          await note(`Skipped ${what} from my plan: ${ready.why}.`);
          return;
        }
        result = await goal.run(step.args);
      } catch (error) {
        threw = true;
        console.error(`Plan step "${what}" went wrong:`, error);
      }
      const cancelled = isCommandCancelled();
      const reason = String(currentSignal()?.reason ?? "");
      const status = stepStatusAfter({ threw, cancelled, reason, ok: result?.ok ?? false });
      // The exact reason, for the diary and for the model: the typed reason
      // with its detail, or where it got stuck
      const why = threw ? "something went wrong (an error in my code, see the log)" : cancelled ? (reason === "stuck" ? await stuckReason() : reason) : result && !result.ok ? describeFailure(result) : "";
      await markStep(planId, index, status, status === "failed" ? why : undefined);
      // A new plan came while it worked (its own plans let the running step
      // finish): the work is real, so it goes in the diary and a failure is
      // remembered for the next plan, but nothing is asked of the model now
      const replaced = currentPlanId() !== planId;
      if (status === "done") {
        noteProgress();
        await note(`Done from my ${replaced ? "earlier " : ""}plan: ${what}.`);
      }
      if (status === "failed") {
        // A wait (hurt, hungry, refused at night) is no failure of the job:
        // written down for the next plan, the plan goes on with its next
        // step. A real failure is thought over at once (the planner waits
        // longer each time in a row that nothing got done); its own life
        // waits for the answer
        const wait = !threw && !cancelled && result !== null && !result.ok && (await waitNotFailure(result.reason));
        const failed = noteFailure("plan step", failureKey(step.goal, step.args), what, why, wait);
        // The diary keeps the place too (its weekly lessons are written from
        // the diary: with no place in it there was nothing to learn)
        await note(`${cancelled ? "Gave up on" : "Couldn't do"} ${what}: ${why}${/stuck at /.test(why) ? "" : ` (at ${failed.where})`}.`);
        if (!wait && !replaced) planAgain("blocked");
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
