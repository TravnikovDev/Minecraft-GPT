// Path: src/core/arbiter.ts
// The one place that decides what the bot does (Phase 4). Everything is a
// task proposed to the arbiter with a priority bucket:
//
//   0 survival   (running out of air, lava, falling)      - reflexes (leases)
//   1 threats    (a creeper, a fight, critical health)     - reflexes (leases)
//   2 owner      (commands from the owner)
//   3 role       (farmer, guard... duties; Phase 8)
//   4 upkeep     (hunger, night, full inventory, tool wear)
//   5 self       (the next milestone; Phase 7)
//   6 idle       (tidying up, replanting, taking down scaffolding)
//
// The arbiter runs the most urgent task. A more urgent one cuts in: the
// running task is cancelled through its abort signal, the arbiter waits for
// it to clean up (stop walking, stop digging, close the window), and only
// then starts the next. A task that was cut off goes back to the front of
// the queue, rebuilt from where things stand now (`resume`), so "come here"
// in the middle of gathering wood comes, then gathers the rest.
//
// Reflexes (buckets 0-1) don't cancel tasks: they take the body's resources
// urgently (core/leases), which pauses the task at its next action; it
// carries on when they let go. Within a bucket the running task keeps going
// (inertia); a new one of the same bucket waits, unless it `interrupts`.
//
// There is no polling loop: proposing a task, or a task ending, schedules.

import { runWithSignal, setCurrentCommandName, waitForCleanup } from "./commandContext";
import { setTaskHolder } from "./leases";
import { haltBody } from "./plugins";

export const Bucket = { Survival: 0, Threat: 1, Owner: 2, Role: 3, Upkeep: 4, Self: 5, Idle: 6 } as const;

export type Outcome = "done" | "failed" | "cancelled";

export type TaskSpec = {
  name: string;
  bucket: number;
  /** The work; runs with the task's abort signal in async context (isCommandCancelled). */
  run: () => Promise<void>;
  /** May cut in on a running task of the same bucket (an owner's "come here", "follow me"). */
  interrupts?: boolean;
  /**
   * Cut off by a more urgent task (`cutInBy`): the task to carry on with
   * later, from where things stand then, or null to drop it. Never called
   * when the owner said stop, or the task got stuck or took too long.
   */
  resume?: (cutInBy: { name: string; bucket: number } | null) => TaskSpec | null;
  /** Any new task of the same bucket may cut in (following the owner: the next command goes first). */
  yields?: boolean;
  /** False for tasks that legitimately stand still (following an owner who stands still): the stuck watcher leaves them alone. */
  watchProgress?: boolean;
  /** Gives up after this long (a backstop; tasks have their own checks). */
  maxMs?: number;
  /** Called when it starts (e.g. "Back to gathering wood"). */
  onStart?: (resumed: boolean) => void;
  /** Called once with how it ended. */
  onEnd?: (outcome: Outcome, error?: unknown) => void;
};

type Entry = { id: number; spec: TaskSpec; resumed: boolean; front?: boolean };
type Running = Entry & { abort: AbortController; done: Promise<Outcome>; startedAt: number; noResume?: boolean };

/** How long a cancelled task gets to clean up before the next one starts anyway. */
const CLEANUP_MS = 10_000;

let nextId = 1;
const pending: Entry[] = [];
let running: Running | null = null;
let scheduling = false;
// Bumped by stopAll: a cut-in that was cleaning up when the owner said stop must not start anything
let epoch = 0;
let again = false;
const startHooks: Array<(task: { name: string; bucket: number }) => void> = [];
const endHooks: Array<(task: { name: string; bucket: number }, outcome: Outcome) => void> = [];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// Buckets 2-5 are "what the bot is doing" (shown in status, blocks idle chores); idle chores aren't
const visible = (spec: TaskSpec): boolean => spec.bucket >= Bucket.Owner && spec.bucket < Bucket.Idle;

/** Proposes a task. Returns its id; it runs when nothing more urgent is waiting. */
export function propose(spec: TaskSpec, options: { front?: boolean } = {}): number {
  const entry: Entry = { id: nextId++, spec, resumed: false, front: options.front };
  if (options.front) {
    // Ahead of the others, but after earlier front ones (steps keep their order)
    let at = 0;
    while (at < pending.length && pending[at].front) at++;
    pending.splice(at, 0, entry);
  } else pending.push(entry);
  void schedule();
  return entry.id;
}

/** The running task (name and bucket), if any. */
export function currentTask(): { name: string; bucket: number; startedAt: number; watchProgress: boolean } | null {
  return running
    ? { name: running.spec.name, bucket: running.spec.bucket, startedAt: running.startedAt, watchProgress: running.spec.watchProgress !== false }
    : null;
}

/** Tasks waiting to run, most urgent first. */
export function pendingTasks(): { name: string; bucket: number }[] {
  return ordered().map((e) => ({ name: e.spec.name, bucket: e.spec.bucket }));
}

/** Runs for every task that starts / ends (the stuck watcher uses these). */
export function onTaskStart(hook: (task: { name: string; bucket: number }) => void): void {
  startHooks.push(hook);
}
export function onTaskEnd(hook: (task: { name: string; bucket: number }, outcome: Outcome) => void): void {
  endHooks.push(hook);
}

/** Pending tasks in the order they would run: by bucket, then as queued. */
function ordered(): Entry[] {
  return pending.map((e, i) => ({ e, i })).sort((a, b) => a.e.spec.bucket - b.e.spec.bucket || a.i - b.i).map((x) => x.e);
}

/** Whether `next` may cut in on `current`. */
function cutsIn(next: TaskSpec, current: TaskSpec): boolean {
  return next.bucket < current.bucket || (next.bucket === current.bucket && Boolean(next.interrupts || current.yields));
}

async function schedule(): Promise<void> {
  if (scheduling) {
    again = true;
    return;
  }
  scheduling = true;
  try {
    do {
      again = false;
      await step();
    } while (again);
  } finally {
    scheduling = false;
  }
}

async function step(): Promise<void> {
  const next = ordered()[0];
  if (!next) return;
  let now = next;
  const startedIn = epoch;
  if (running) {
    if (!cutsIn(next.spec, running.spec)) return;
    await cancelRunning(`${next.spec.name} cut in`, true, CLEANUP_MS, { name: next.spec.name, bucket: next.spec.bucket });
    if (epoch !== startedIn) return; // the owner said stop meanwhile
    // The task that cut in goes first (the one it cut off waits at the front
    // of the queue), unless something more urgent came in while it cleaned up
    const first = ordered()[0];
    now = pending.includes(next) && (!first || first.spec.bucket >= next.spec.bucket) ? next : first;
  }
  if (!now) return;
  pending.splice(pending.indexOf(now), 1);
  start(now);
  again = true; // something more urgent may already be waiting
}

function start(entry: Entry): void {
  const abort = new AbortController();
  const { spec } = entry;
  const task = { name: spec.name, bucket: spec.bucket };
  setTaskHolder(task);
  if (visible(spec)) setCurrentCommandName(spec.name);
  let limit: ReturnType<typeof setTimeout> | undefined;
  if (spec.maxMs && Number.isFinite(spec.maxMs)) {
    limit = setTimeout(() => {
      if (running?.id !== entry.id) return;
      console.log(`Task ${spec.name} ran longer than ${Math.round(spec.maxMs! / 60_000)} min; stopping it.`);
      void cancelRunning("took too long", false);
    }, spec.maxMs);
  }
  for (const hook of startHooks) safely(() => hook(task));
  try {
    spec.onStart?.(entry.resumed);
  } catch (error) {
    console.error(`Starting ${spec.name} failed:`, error);
  }
  console.log(`Task started: ${spec.name} (bucket ${spec.bucket}${entry.resumed ? ", resumed" : ""}).`);

  const done: Promise<Outcome> = runWithSignal(abort.signal, () => spec.run()).then(
    () => (abort.signal.aborted ? "cancelled" : "done"),
    (error) => {
      if (!abort.signal.aborted) console.error(`Task ${spec.name} failed:`, error);
      return abort.signal.aborted ? "cancelled" : "failed";
    }
  );
  running = { ...entry, abort, done, startedAt: Date.now() };
  void done.then((outcome) => {
    clearTimeout(limit);
    finish(entry.id, outcome);
  });
}

function finish(id: number, outcome: Outcome): void {
  const ended = running;
  if (!ended || ended.id !== id) return; // already replaced (cancelled and moved on)
  running = null;
  setTaskHolder(null);
  setCurrentCommandName(null);
  const task = { name: ended.spec.name, bucket: ended.spec.bucket };
  safely(() => ended.spec.onEnd?.(outcome));
  for (const hook of endHooks) safely(() => hook(task, outcome));
  console.log(`Task ended: ${ended.spec.name} (${outcome}).`);
  void schedule();
}

/**
 * Cancels the running task: aborts it, stops the body, and waits (up to
 * CLEANUP_MS) for it to wind down. With `resume`, a task that can be resumed
 * goes back to the front of the queue, rebuilt from where things stand now.
 */
export async function cancelRunning(
  reason: string,
  resume = false,
  cleanupMs = CLEANUP_MS,
  cutInBy: { name: string; bucket: number } | null = null
): Promise<void> {
  const victim = running;
  if (!victim) return;
  // Stop, stuck or too long: never resumed, even if a cut-in is also ending it
  if (!resume) victim.noResume = true;
  if (victim.abort.signal.aborted) {
    await Promise.race([victim.done, sleep(cleanupMs)]); // already being cancelled: just wait
    return;
  }
  console.log(`Cancelling task ${victim.spec.name}: ${reason}.`);
  victim.abort.abort(reason);
  haltBody({ keepUrgent: true }); // a reflex holding the body (running from mobs) keeps it
  await Promise.race([victim.done, sleep(cleanupMs)]);
  await waitForCleanup(cleanupMs); // e.g. getting out of a boat first
  // Never settled: don't let it block the next task
  if (running?.id === victim.id) finish(victim.id, "cancelled");
  // What's left is worked out only now that it has stopped (a step that
  // finished while it wound down counts as done, not as left to do)
  if (resume && !victim.noResume && victim.spec.resume) {
    const again = safely(() => victim.spec.resume!(cutInBy));
    if (again) pending.unshift({ id: nextId++, spec: again, resumed: true, front: true });
  }
}

/** Removes waiting tasks (all, or those `which` picks). */
export function dropPending(which: (task: { name: string; bucket: number }) => boolean = () => true): number {
  let removed = 0;
  for (let i = pending.length - 1; i >= 0; i--) {
    if (which({ name: pending[i].spec.name, bucket: pending[i].spec.bucket })) {
      pending.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

/** The owner's stop, or a dropped connection: cancel the running task and drop everything waiting. */
export async function stopAll(reason: string): Promise<void> {
  epoch++;
  dropPending();
  await cancelRunning(reason, false);
  dropPending(); // anything a cancelled task proposed on its way out
}

/** A new connection: nothing is running, nothing waits. */
export function resetArbiter(): void {
  running?.abort.abort("new connection");
  running = null;
  pending.length = 0;
  setTaskHolder(null);
  setCurrentCommandName(null);
}

function safely<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch (error) {
    console.error("Arbiter hook failed:", error);
    return null;
  }
}
