// Path: src/core/chores.ts
// Idle chores (tidying up, replanting, taking down scaffolding) run here, one
// at a time, each with its own abort signal in the same async context that
// commands use, so isCommandCancelled() inside a chore means "this chore was
// stopped". The owner's stop, any new command and a dropped connection end
// the running chore; stop also keeps chores quiet for a while, so the bot
// really stands still. A chore only walks, picks things up and breaks the
// bot's own scaffolding: inChore() lets the bigger steps refuse.

import { AsyncLocalStorage } from "node:async_hooks";
import { runWithSignal } from "./commandContext";
import { pathing } from "./plugins";

/** How long to wait for a stopped chore to wind down before moving on. */
const WIND_DOWN_MS = 3000;

type Chore = { name: string; abort: AbortController; done: Promise<void> };
let running: Chore | null = null;
let mutedUntil = 0;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// Marks code running for a chore, so big steps (making a chest, crafting a
// tool, fetching wood) are left to tasks the owner gave
const inChoreContext = new AsyncLocalStorage<string>();

/** True when this code runs for an idle chore, not for an owner's task. */
export function inChore(): boolean {
  return inChoreContext.getStore() !== undefined;
}

/** True while a chore runs. */
export function isChoreRunning(): boolean {
  return running !== null;
}

/** True while the owner's stop keeps chores quiet. */
export function areChoresMuted(): boolean {
  return Date.now() < mutedUntil;
}

/**
 * Runs `job` as the one chore, unless a chore is already running or chores
 * are muted. Returns false if it didn't run.
 */
export async function runChore(name: string, job: () => Promise<void>): Promise<boolean> {
  if (running || areChoresMuted()) return false;
  const abort = new AbortController();
  const chore: Chore = {
    name,
    abort,
    done: inChoreContext
      .run(name, () => runWithSignal(abort.signal, job))
      .catch((error) => {
        if (!abort.signal.aborted) console.log(`Chore "${name}" failed: ${(error as Error).message}`);
      })
      .finally(() => {
        if (running === chore) running = null;
      }),
  };
  running = chore;
  await chore.done;
  return true;
}

/**
 * Ends the running chore (if any) and waits for it to wind down, at most a
 * few seconds: a walk cut off by a disconnect may never settle, and must not
 * block chores forever. `muteMs` keeps new chores from starting.
 */
export async function stopChores(reason: string, muteMs = 0): Promise<void> {
  if (muteMs > 0) mutedUntil = Math.max(mutedUntil, Date.now() + muteMs);
  const chore = running;
  if (!chore) return;
  console.log(`Stopping chore "${chore.name}": ${reason}.`);
  chore.abort.abort(reason);
  pathing.stop(); // a walk in progress ends now
  await Promise.race([chore.done, sleep(WIND_DOWN_MS)]);
  if (running === chore) running = null; // never settled: don't let it block the next one
}

/** A new connection starts with no chore and no mute. */
export function resetChores(): void {
  running?.abort.abort("new connection");
  running = null;
  mutedUntil = 0;
}
