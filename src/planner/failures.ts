// Path: src/planner/failures.ts
// What went wrong today, for the day planner (failure advice): each plan step
// or milestone that failed is kept with its exact reason, where it happened
// and how often, so the model can decide what to do about it (fix the cause,
// another way, later, or not today). A job is known by its goal and what it
// is for, never by its count or its wording ("mineFor:raw_iron",
// "reachMilestone:iron"): 8 instead of 10 is the same job, and a milestone
// failing as code's own fallback is the same job as the plan's step for it.
// A wait (hurt, hungry, night) is written down but is no failure of the job.
// Kept in the process, per game day: a new day or a restart starts clean. A
// leaf module (the curriculum, the plan runner and the planner all use it).

import { bot } from "../core/body";
import { gameDay, partOfDay } from "./diary";

export type FailureKind = "plan step" | "milestone";
/** `times`: how often it stopped today; `strikes`: how many of those were real failures (not waits). */
export type FailureNote = { key: string; kind: FailureKind; what: string; reason: string; where: string; time: string; at: number; times: number; strikes: number; wait: boolean };

// The same job really failing this often in a day is off the plan until tomorrow
export const MAX_SAME_FAILURES = 3;
// A new plan after a failure: at once the first time, then this much longer
// each time in a row with nothing done in between (a job it can never do
// must not ask the model every minute all day)
const BLOCKED_GAP_STEP_MS = 60_000;
const BLOCKED_GAP_MAX_MS = 15 * 60_000;
// A failure no plan took up within this long is no longer "what just went wrong"
const FRESH_FOR_MS = 5 * 60_000;

// What a job is for (its count and anything else left out)
const IDENTITY_ARGS = ["milestone", "item", "animal", "lookFor"];

let day = -1;
let notes: FailureNote[] = [];
let blockedInRow = 0;
// The failure the next plan is about (taken once by the planner)
let fresh: FailureNote | null = null;

/** A job's name for counting its failures: the goal and what it's for, without the count. Pure. */
export function failureKey(goal: string, args: Record<string, unknown>): string {
  const id = IDENTITY_ARGS.map((k) => args[k]).filter((v): v is string => typeof v === "string" && v.length > 0);
  return id.length > 0 ? `${goal}:${id.join(",")}` : goal;
}

/**
 * True when a stop was a wait, not a failure of the job: it was hurt or too
 * hungry for it, or the job was refused because it isn't working time (night
 * after an attack). The same test the curriculum's set-aside uses. Pure.
 */
export function isWait(f: { reason: string; unfit: boolean; workingTime: boolean }): boolean {
  return f.unfit || (f.reason === "refused" && !f.workingTime);
}

/** The list with one more stop of the job `f.key` (counted, the newest reason kept, newest last). Pure. */
export function withFailure(list: FailureNote[], f: Omit<FailureNote, "times" | "strikes">): FailureNote[] {
  const before = list.find((n) => n.key === f.key);
  return [...list.filter((n) => n !== before), { ...f, times: (before?.times ?? 0) + 1, strikes: (before?.strikes ?? 0) + (f.wait ? 0 : 1) }];
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
  const often = f.strikes > 1 ? `; failed ${f.strikes} times today` : "";
  const wait = f.wait ? "; a wait, not a failure of the job: it can go again once that's over" : "";
  return `${f.kind} "${f.what}": ${f.reason} (at ${f.where}, in the ${f.time}, ${ago === 0 ? "just now" : `${ago} min ago`}${often}${wait})`;
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

/**
 * Remembers that the job `key` (see failureKey) stopped just now, and why.
 * `wait`: it was a wait (isWait), written down but not counted against the job.
 */
export function noteFailure(kind: FailureKind, key: string, what: string, reason: string, wait = false): FailureNote {
  const p = bot.entity?.position;
  const where = p ? `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}` : "unknown";
  notes = withFailure(today(), { key, kind, what, reason: reason.trim() || "no reason given", where, time: partOfDay(bot.time?.timeOfDay ?? 0), at: Date.now(), wait });
  fresh = notes.at(-1)!;
  return fresh;
}

/** Today's failures, oldest first. */
export const failuresToday = (): FailureNote[] => [...today()];

/** How often the job `key` really failed today (waits aside), and why the last time. */
export function failedToday(key: string): { times: number; reason: string } {
  const f = today().find((n) => n.key === key);
  return { times: f?.strikes ?? 0, reason: f?.reason ?? "" };
}

/** True when the job `key` has failed too often today to be planned again. */
export const struckOut = (key: string): boolean => failedToday(key).times >= MAX_SAME_FAILURES;

/** The failure the next plan is about, once (null when there's none new, or it's minutes old). */
export function takeFreshFailure(now = Date.now()): FailureNote | null {
  today();
  const f = fresh;
  fresh = null;
  return f && now - f.at <= FRESH_FOR_MS ? f : null;
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

/** Nothing remembered (tests; a reconnect keeps the day's failures). */
export function resetFailures(): void {
  day = -1;
  notes = [];
  blockedInRow = 0;
  fresh = null;
}
