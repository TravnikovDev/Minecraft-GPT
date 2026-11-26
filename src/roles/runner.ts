// Path: src/roles/runner.ts
// Runs the role (Phase 8) in bucket B3, a shift at a time: each job does a
// bounded round of work (a minute of guarding, one pass over the field, one
// mining trip) and says how long to rest before the next. Owner commands
// (B2) and reflexes cut in and the shift carries on afterwards. Jobs outside
// in the open (farmer, hauler, builder) work by day: at night the shelter
// routine runs as usual.

import { Bucket, currentTask, pendingTasks, propose, type TaskSpec } from "../core/arbiter";
import { bot, isOnline } from "../core/body";
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

let restUntil = 0;
let lastFailure = "";

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

const isNight = (): boolean => {
  const t = bot.time?.timeOfDay ?? 0;
  return t >= 13000 && t < 23000;
};

/** True when the job may work now (by day, or a night job). Pure. */
export function onShiftNow(job: Job, night: boolean): boolean {
  return !night || NIGHT_JOBS.has(job);
}

/** The task for one shift of the role it has now. */
function shiftTask(role: Role): TaskSpec {
  return {
    name: `${ROLE_PREFIX}${role.job}${role.target ? ` (${role.target.replace(/_/g, " ")})` : ""}`,
    bucket: Bucket.Role,
    maxMs: SHIFT_MAX_MS,
    // A guard stands by the owner on purpose
    watchProgress: role.job !== "guard",
    run: async () => {
      const shift = await shiftFor(role);
      restUntil = Date.now() + shift.restMs;
      if (!shift.result.ok) {
        const why = describeFailure(shift.result);
        // Said once per reason, not every shift
        if (why !== lastFailure) {
          report(`As your ${role.job}: ${why}.`);
          void note(`As the owner's ${role.job}: ${why}.`);
        }
        lastFailure = why;
      } else {
        lastFailure = "";
      }
    },
    // Cut off: on with the job afterwards, if it still has it
    resume: () => {
      const now = currentRole();
      return now && now.since === role.since ? shiftTask(now) : null;
    },
  };
}

/** Called every few seconds: starts the next shift when it's due. */
export function considerRole(): void {
  const role = currentRole();
  if (!role || !bot.entity || !isOnline() || Date.now() < restUntil || !automationAllowed()) return;
  if (!onShiftNow(role.job, isNight())) return;
  const running = currentTask();
  if (running && running.bucket <= Bucket.Role) return; // the owner, a reflex, or a shift already
  if (pendingTasks().some((t) => t.name.startsWith(ROLE_PREFIX))) return;
  propose(shiftTask(role));
}

/** A new role or none: the next shift starts at once. */
export function resetRoleRest(): void {
  restUntil = 0;
  lastFailure = "";
}
