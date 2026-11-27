// Path: src/core/reflexes.ts
// Survival reflexes (running out of air, a creeper, a fight) as urgent
// holders of the body (core/leases). A reflex takes movement and hands: the
// running task pauses at its next action (walking, digging, placing waits
// here) and carries on once the reflex lets go. Reflex code runs as its own
// holder (asReflex), so its own actions never wait for itself.
//
// The owner's "stop" also stops reflexes that can be stopped (fighting,
// creepers) and mutes them for a while: a mob farm full of penned-in creepers
// or zombies is no danger, and the owner decides that, not the bot.
// Running out of air is never muted.

import { isTakenUrgently, release, runAs, takeoverCount, takeUrgently, waitTurn, type Holder } from "./leases";

// How urgent each reflex is (core/arbiter buckets: 0 survival, 1 threats)
const BUCKETS: Record<string, number> = { drowning: 0, lava: 0, suffocation: 0, creeper: 1, combat: 1, unstuck: 1 };
const holders = new Map<string, Holder>();
// Reflexes the owner can stop, and how each one ends itself
const stoppers = new Map<string, () => void>();
let mutedUntil = 0;

/** The holder a reflex acts as. */
export function reflexHolder(name: string): Holder {
  let holder = holders.get(name);
  if (!holder) {
    holder = { name, bucket: BUCKETS[name] ?? 1 };
    holders.set(name, holder);
  }
  return holder;
}

/** Runs reflex code as that reflex (its walking, looking and hitting don't wait for itself). */
export function asReflex<T>(name: string, fn: () => T): T {
  return runAs(reflexHolder(name), fn);
}

/** A reflex takes the body (true) or lets go (false). */
export function setReflexActive(name: string, on: boolean): void {
  // Movement, hands, and any open window (it closes it: hands can't swap items in a chest)
  if (on) takeUrgently(reflexHolder(name), ["movement", "hands", "window"]);
  else release(reflexHolder(name), ["movement", "hands", "window"]);
}

/** True while any reflex has the body. */
export function isAnyReflexActive(): boolean {
  return isTakenUrgently("movement") || isTakenUrgently("hands");
}

/** Counter of reflex takeovers; compare before and after a walk. */
export function reflexTakeovers(): number {
  return takeoverCount("movement");
}

/**
 * Waits until no reflex has the body (for the code calling it). Returns early
 * when `cancelled()` says so, so a stopped task never stays parked here.
 */
export async function waitForReflexes(cancelled: () => boolean = () => false): Promise<void> {
  await waitTurn("movement", cancelled);
}

/** Lets the owner's "stop" end this reflex (fighting, creepers; not drowning). */
export function registerReflexStopper(name: string, stop: () => void): void {
  stoppers.set(name, stop);
}

/** The owner said stop: end the stoppable reflexes and keep them quiet for `muteMs`. */
export function stopReflexes(muteMs: number): void {
  mutedUntil = Date.now() + muteMs;
  for (const [name, stop] of stoppers) {
    try {
      asReflex(name, stop);
    } catch (error) {
      console.error(`Stopping the ${name} reflex failed:`, error);
    }
  }
}

/** True while the owner's "stop" keeps the stoppable reflexes quiet. */
export function areReflexesMuted(): boolean {
  return Date.now() < mutedUntil;
}

/** Clears everything (a new connection starts with no reflex running). */
export function resetReflexes(): void {
  for (const holder of holders.values()) release(holder);
  stoppers.clear();
  mutedUntil = 0;
}
