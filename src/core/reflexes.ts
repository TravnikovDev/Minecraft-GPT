// Path: src/core/reflexes.ts
// Which survival reflexes (creeper, drowning, combat) currently own the bot's
// movement. A reflex takes over by clearing the path goal; task movement
// (pathing.goto) waits here while any reflex is active and then resumes, so a
// task is paused by a reflex instead of failing or fighting it for control.
//
// The owner's "stop" also stops reflexes that can be stopped (fighting,
// creepers) and mutes them for a while: a mob farm full of penned-in creepers
// or zombies is no danger, and the owner decides that, not the bot.
// Running out of air is never muted.
//
// Kept free of other imports so core/plugins can use it without a cycle.

const active = new Set<string>();
// Bumped each time a reflex starts, so a walk can tell it was interrupted by one
let takeovers = 0;
// Reflexes the owner can stop, and how each one ends itself
const stoppers = new Map<string, () => void>();
let mutedUntil = 0;

/** Marks a reflex as owning movement (true) or done (false). */
export function setReflexActive(name: string, on: boolean): void {
  if (on && !active.has(name)) takeovers++;
  if (on) active.add(name);
  else active.delete(name);
}

/** True while any reflex owns movement. */
export function isAnyReflexActive(): boolean {
  return active.size > 0;
}

/** Counter of reflex takeovers; compare before and after a walk. */
export function reflexTakeovers(): number {
  return takeovers;
}

/**
 * Waits until no reflex owns movement. Returns early when `cancelled()` says
 * so, so a stopped command never stays parked here.
 */
export async function waitForReflexes(cancelled: () => boolean = () => false): Promise<void> {
  while (active.size > 0 && !cancelled()) await new Promise((r) => setTimeout(r, 250));
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
      stop();
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
  active.clear();
  stoppers.clear();
  mutedUntil = 0;
}
