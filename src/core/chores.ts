// Path: src/core/chores.ts
// Idle chores (tidying up, replanting, taking down scaffolding) are arbiter
// tasks in the lowest bucket (core/arbiter): they run only when nothing else
// wants the bot, any other task cuts in on them (they're not resumed; their
// timers propose them again later), and the owner's stop ends the running
// one and keeps chores quiet for a while, so the bot really stands still.
// A chore only walks, picks things up and breaks the bot's own scaffolding:
// inChore() lets the bigger steps (making a chest, crafting a tool) refuse.

import { AsyncLocalStorage } from "node:async_hooks";
import { Bucket, cancelRunning, currentTask, dropPending, pendingTasks, propose } from "./arbiter";

let mutedUntil = 0;
// Marks code running for a chore, so big steps are left to tasks the owner gave
const inChoreContext = new AsyncLocalStorage<string>();

/** True when this code runs for an idle chore, not for an owner's task. */
export function inChore(): boolean {
  return inChoreContext.getStore() !== undefined;
}

/** True while a chore runs or waits to run. */
export function isChoreRunning(): boolean {
  return currentTask()?.bucket === Bucket.Idle || pendingTasks().some((t) => t.bucket === Bucket.Idle);
}

/** True while the owner's stop keeps chores quiet. */
export function areChoresMuted(): boolean {
  return Date.now() < mutedUntil;
}

/**
 * Proposes `job` as the one idle chore, unless one is already running or
 * waiting, or chores are muted. Resolves when the chore ends; false if it
 * wasn't proposed.
 */
export function runChore(name: string, job: () => Promise<void>): Promise<boolean> {
  if (isChoreRunning() || areChoresMuted()) return Promise.resolve(false);
  return new Promise((resolve) => {
    propose({
      name,
      bucket: Bucket.Idle,
      run: () => inChoreContext.run(name, job),
      onEnd: () => resolve(true),
    });
  });
}

/**
 * Ends the running chore (if any) and drops waiting ones; `muteMs` keeps new
 * chores from starting. Any other task cuts in on a chore by itself.
 */
export async function stopChores(reason: string, muteMs = 0): Promise<void> {
  if (muteMs > 0) mutedUntil = Math.max(mutedUntil, Date.now() + muteMs);
  dropPending((t) => t.bucket === Bucket.Idle);
  // A chore only walks and picks things up: a few seconds is plenty to wind down
  if (currentTask()?.bucket === Bucket.Idle) await cancelRunning(reason, false, 3_000);
}

/** A new connection starts with no mute (the arbiter itself is reset separately). */
export function resetChores(): void {
  mutedUntil = 0;
}
