// Path: src/planner/names.ts
// The few things the curriculum and the plan runner share, in a leaf module
// (no imports), so the curriculum never loads the planner statically: plan
// task names, the gate that says when a plan step may run now, which goals
// work in its mine or need daylight, and which milestones are set aside.

/** Plan step tasks are named "plan: chopping 16 logs". */
export const PLAN_PREFIX = "plan: ";

export type StepLike = { goal: string; args: Record<string, unknown> };

/** Goals that work down in its mine (they run at night too, and don't climb out first). */
export const worksInTheMine = (goal: string): boolean => goal === "mineFor" || goal === "mendMine";

/** Goals that only work by daylight, whatever else (fishing): the step waits for the day. */
export const needsDaylight = (goal: string): boolean => goal === "goFishing";

let gate: (step: StepLike) => boolean = () => true;

/** Set by the curriculum: at night only steps under ground, and only once it's home. */
export function setStepGate(allowed: (step: StepLike) => boolean): void {
  gate = allowed;
}

/** True when this step may run now (proposed or resumed after a cut-in). */
export const stepAllowedNow = (step: StepLike): boolean => gate(step);

let aside: (milestone: string) => boolean = () => false;

/** Set by the curriculum: which milestones it has set aside for a while after a failure. */
export function setMilestoneAside(check: (milestone: string) => boolean): void {
  aside = check;
}

/** True when the curriculum has this milestone set aside right now (a short topped-up plan leaves it out). */
export const milestoneSetAside = (milestone: string): boolean => aside(milestone);
