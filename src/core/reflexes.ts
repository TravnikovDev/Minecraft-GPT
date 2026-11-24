// Path: src/core/reflexes.ts
// Which survival reflexes (creeper, drowning, combat) currently own the bot's
// movement. A reflex takes over by clearing the path goal; task movement
// (pathing.goto) waits here while any reflex is active and then resumes, so a
// task is paused by a reflex instead of failing or fighting it for control.
// Kept free of other imports so core/plugins can use it without a cycle.

const active = new Set<string>();
// Bumped each time a reflex starts, so a walk can tell it was interrupted by one
let takeovers = 0;

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

/** Waits until no reflex owns movement. */
export async function waitForReflexes(): Promise<void> {
  while (active.size > 0) await new Promise((r) => setTimeout(r, 250));
}

/** Clears everything (a new connection starts with no reflex running). */
export function resetReflexes(): void {
  active.clear();
}
