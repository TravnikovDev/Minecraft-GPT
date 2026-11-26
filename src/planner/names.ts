// Path: src/planner/names.ts
// The few things the curriculum and the plan runner share, in a leaf module
// (no imports), so the curriculum never loads the planner statically: plan
// task names and the gate that says when a plan step may run now.

/** Plan step tasks are named "plan: chopping 16 logs". */
export const PLAN_PREFIX = "plan: ";

export type StepLike = { goal: string; args: Record<string, unknown> };

let gate: (step: StepLike) => boolean = () => true;

/** Set by the curriculum: at night only steps under ground, and only once it's home. */
export function setStepGate(allowed: (step: StepLike) => boolean): void {
  gate = allowed;
}

/** True when this step may run now (proposed or resumed after a cut-in). */
export const stepAllowedNow = (step: StepLike): boolean => gate(step);
