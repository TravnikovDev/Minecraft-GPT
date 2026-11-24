// Path: src/core/failures.ts
// Things that recently failed, with an expiry ("the spot at x, y, z is
// unreachable; try again in 10 minutes"). The stuck watcher records them when
// it gives up on a task, and walking checks them, so the bot doesn't walk
// into the same dead end over and over like a player who learned the lesson.

type Fact = { reason: string; until: number };
const facts = new Map<string, Fact>();

/** Remembers that `key` failed, for `ms`. */
export function rememberFailure(key: string, reason: string, ms: number): void {
  facts.set(key, { reason, until: Date.now() + ms });
}

/** Why `key` failed recently, or null if it didn't (or that's long enough ago). */
export function recentFailure(key: string): string | null {
  const fact = facts.get(key);
  if (!fact) return null;
  if (Date.now() > fact.until) {
    facts.delete(key);
    return null;
  }
  return fact.reason;
}

/** The key for a walking goal's spot (blocks within 2 of each other count as the same place). */
export function placeKey(p: { x: number; y: number; z: number }): string {
  const r = (n: number): number => Math.round(n / 2) * 2;
  return `place:${r(p.x)},${r(p.y)},${r(p.z)}`;
}

/** Forgets everything (tests). */
export function clearFailures(): void {
  facts.clear();
}
