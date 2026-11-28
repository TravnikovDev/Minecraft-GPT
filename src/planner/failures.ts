// Path: src/planner/failures.ts
// What went wrong today, for the day planner (failure advice): each plan step
// or milestone that failed is kept with its exact reason, where it happened
// and how often, so the model can decide what to do about it (fix the cause,
// another way, later, or not today). Kept in the process, per game day: a
// new day or a restart starts clean. A leaf module (the curriculum, the plan
// runner and the planner all use it).

import { bot } from "../core/body";
import { gameDay, partOfDay } from "./diary";

export type FailureKind = "plan step" | "milestone";
export type FailureNote = { kind: FailureKind; what: string; reason: string; where: string; time: string; at: number; times: number };

// The same job failing this often in a day is off the plan until tomorrow
export const MAX_SAME_FAILURES = 3;
// A new plan after a failure: at once the first time, then this much longer
// each time in a row with nothing done in between (a job it can never do
// must not ask the model every minute all day)
const BLOCKED_GAP_STEP_MS = 60_000;
const BLOCKED_GAP_MAX_MS = 15 * 60_000;

let day = -1;
let notes: FailureNote[] = [];
let blockedInRow = 0;
// The failure the next plan is about (taken once by the planner)
let fresh: FailureNote | null = null;

/** The list with one more failure of `what` (counted, the newest reason kept, newest last). Pure. */
export function withFailure(list: FailureNote[], f: Omit<FailureNote, "times">): FailureNote[] {
  const before = list.find((n) => n.kind === f.kind && n.what === f.what);
  return [...list.filter((n) => n !== before), { ...f, times: (before?.times ?? 0) + 1 }];
}

/**
 * How long to wait before planning again after the `n`th failure in a row
 * with nothing done in between (n = 0: the first, at once). Pure.
 */
export function blockedGapMs(n: number): number {
  return n <= 0 ? 0 : Math.min(BLOCKED_GAP_STEP_MS * 2 ** (n - 1), BLOCKED_GAP_MAX_MS);
}

/** A failure as one line for the model: what, why, where, when, how often. Pure. */
export function failureLine(f: FailureNote, now = Date.now()): string {
  const ago = Math.max(0, Math.round((now - f.at) / 60_000));
  return `${f.kind} "${f.what}": ${f.reason} (at ${f.where}, in the ${f.time}, ${ago === 0 ? "just now" : `${ago} min ago`}${f.times > 1 ? `; failed ${f.times} times today` : ""})`;
}

function today(): FailureNote[] {
  const now = gameDay();
  if (now !== day) {
    day = now;
    notes = [];
    blockedInRow = 0;
    fresh = null;
  }
  return notes;
}

/** Remembers that `what` failed just now, and why. */
export function noteFailure(kind: FailureKind, what: string, reason: string): FailureNote {
  const p = bot.entity?.position;
  const where = p ? `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}` : "unknown";
  notes = withFailure(today(), { kind, what, reason: reason.trim() || "no reason given", where, time: partOfDay(bot.time?.timeOfDay ?? 0), at: Date.now() });
  fresh = notes.at(-1)!;
  return fresh;
}

/** Today's failures, oldest first. */
export const failuresToday = (): FailureNote[] => [...today()];

/** How often `what` failed today, and why the last time. */
export function failedToday(what: string): { times: number; reason: string } {
  const all = today().filter((n) => n.what === what);
  return { times: all.reduce((n, f) => n + f.times, 0), reason: all.at(-1)?.reason ?? "" };
}

/** The failure the next plan is about, once (null when there's none new). */
export function takeFreshFailure(): FailureNote | null {
  today();
  const f = fresh;
  fresh = null;
  return f;
}

/** Something got done: the next failure is planned for at once again. */
export function noteProgress(): void {
  blockedInRow = 0;
}

/** A plan was asked for because of a failure. */
export function noteBlockedPlan(): void {
  today();
  blockedInRow++;
}

/** The wait before the next plan asked for because of a failure. */
export const nextBlockedGapMs = (): number => blockedGapMs((today(), blockedInRow));

/** A new connection or a test: nothing remembered. */
export function resetFailures(): void {
  day = -1;
  notes = [];
  blockedInRow = 0;
  fresh = null;
}
