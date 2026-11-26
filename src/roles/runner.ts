// Path: src/roles/runner.ts
// Runs the role (Phase 8) in bucket B3, a shift at a time: each job does a
// bounded round of work and says how long to rest before the next. A shift
// is proposed only when there's work to see (the owner in sight, a ripe
// crop, a misplaced item), so it never takes turns with the night routine or
// its own life for nothing. Owner commands (B2) and reflexes cut in and the
// shift carries on afterwards; "stop" pauses the role for the quiet minute,
// "off duty" ends it; a new job never runs a leftover shift of the old one.
// Failures back off (30 s, 1, 2, 4 ... up to 10 minutes); a job that gets
// nothing done three shifts running pauses for 10 minutes and says why.
// Outdoor jobs work by day; the guard and the miner day and night.

import { Bucket, currentTask, pendingTasks, propose, type TaskSpec } from "../core/arbiter";
import { bot, isOnline } from "../core/body";
import { areChoresMuted } from "../core/chores";
import { currentSignal, isCommandCancelled } from "../core/commandContext";
import { describeFailure } from "../core/result";
import { report } from "../core/narrator";
import { note } from "../planner/diary";
import { currentRole, type Job, type Role } from "./role";
import { automationAllowed } from "../config/serverProfile";
import type { Shift } from "./guard";

export const ROLE_PREFIX = "role: ";
// A shift is bounded by its job; this is the arbiter's backstop
const SHIFT_MAX_MS = 15 * 60_000;
// Jobs that work under ground or beside the owner: night doesn't stop them
const NIGHT_JOBS = new Set<Job>(["guard", "miner"]);
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000;
const NO_PROGRESS_SHIFTS = 3;
const PAUSE_MS = 10 * 60_000;

let restUntil = 0;
let failures = 0;
let idleShifts = 0;
let lastFailure = "";

/** How long to rest after `n` failed shifts in a row: 30 s doubling, up to 10 minutes. Pure. */
export function backoffMs(n: number): number {
  return n <= 0 ? 0 : Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
}

/** The job's shift. */
async function shiftFor(role: Role): Promise<Shift> {
  switch (role.job) {
    case "guard":
      return (await import("./guard")).guardShift(role);
    case "farmer":
      return (await import("./farmer")).farmerShift(role);
    case "miner":
      return (await import("./miner")).minerShift(role);
    case "hauler":
      return (await import("./hauler")).haulerShift(role);
    case "builder":
      return (await import("./builder")).builderShift(role);
  }
}

/** True when there's something for the job to do now (cheap checks only). */
async function hasWork(role: Role): Promise<boolean> {
  switch (role.job) {
    case "guard":
      return (await import("./guard")).guardHasWork(role);
    case "farmer":
      return (await import("./farmer")).farmHasWork(role);
    case "hauler":
      return (await import("./hauler")).haulHasWork(role);
    default:
      return true; // the miner and the builder have work until told otherwise (or done)
  }
}

const isNight = (): boolean => {
  const t = bot.time?.timeOfDay ?? 0;
  return t >= 13000 && t < 23000;
};

/** True when the job may work now (by day, or a night job). Pure. */
export function onShiftNow(job: Job, night: boolean): boolean {
  return !night || NIGHT_JOBS.has(job);
}

/** Says a role problem once per reason (and in the diary). */
function tell(role: Role, why: string): void {
  if (why === lastFailure) return;
  lastFailure = why;
  report(`As your ${role.job}: ${why}.`);
  void note(`As the owner's ${role.job}: ${why}.`);
}

/** The task for one shift of `role` (never run once the owner changed the job). */
function shiftTask(role: Role): TaskSpec {
  const stillMine = (): boolean => currentRole()?.since === role.since;
  return {
    name: `${ROLE_PREFIX}${role.job}${role.target ? ` (${role.target.replace(/_/g, " ")})` : ""}`,
    bucket: Bucket.Role,
    maxMs: SHIFT_MAX_MS,
    // A guard stands by the owner on purpose
    watchProgress: role.job !== "guard",
    run: async () => {
      if (!stillMine()) return; // the job changed while it waited
      let shift: Shift | null = null;
      try {
        shift = await shiftFor(role);
      } catch (error) {
        console.error(`Role shift (${role.job}) went wrong:`, error);
      } finally {
        const why = String(currentSignal()?.reason ?? "");
        const gaveUp = isCommandCancelled() && (why === "stuck" || why === "took too long");
        if (!shift || gaveUp || !shift.result.ok) {
          failures++;
          const result = shift?.result;
          const reason = !shift || !result ? "something went wrong" : gaveUp ? `I got ${why}` : result.ok ? "it didn't work out" : describeFailure(result);
          tell(role, reason);
          restUntil = Date.now() + Math.max(backoffMs(failures), shift?.restMs ?? 0);
        } else {
          failures = 0;
          lastFailure = "";
          idleShifts = shift.progress === false ? idleShifts + 1 : 0;
          restUntil = Date.now() + shift.restMs;
          if (idleShifts >= NO_PROGRESS_SHIFTS) {
            idleShifts = 0;
            restUntil = Date.now() + PAUSE_MS;
            tell(role, "I've got nothing done for a while, so I'm pausing for ten minutes");
          }
        }
      }
    },
    // Cut off: on with the job afterwards, if it's still the job
    resume: () => (stillMine() ? shiftTask(currentRole()!) : null),
  };
}

let checking = false;

/** Called every few seconds: starts the next shift when it's due and there's work. */
export async function considerRole(): Promise<void> {
  const role = currentRole();
  if (!role || !bot.entity || !isOnline() || !automationAllowed() || checking) return;
  // "stop": the role waits out the quiet minute like everything else
  if (areChoresMuted() || Date.now() < restUntil) return;
  if (!onShiftNow(role.job, isNight())) return;
  // Its post is in another dimension: nothing to do from here
  const dimension = (bot.game as { dimension?: string }).dimension ?? "overworld";
  if (role.anchor && role.anchor.dimension !== dimension) return;
  const running = currentTask();
  if (running && running.bucket <= Bucket.Role) return; // the owner, a reflex, or a shift already
  if (pendingTasks().some((t) => t.name.startsWith(ROLE_PREFIX))) return;
  checking = true;
  try {
    if (!(await hasWork(role))) return;
    propose(shiftTask(role));
  } finally {
    checking = false;
  }
}

/** A new role or none: the next shift starts at once, with a clean slate. */
export function resetRoleRest(): void {
  restUntil = 0;
  failures = 0;
  idleShifts = 0;
  lastFailure = "";
}
