// Path: src/core/scaffold.ts
// Blocks the bot put down only to get somewhere: the pathfinder's pillars
// (to reach the top of a tall tree) and bridges. A player takes those down
// again; the bot may break these (and only these) even though they're
// cobblestone or dirt, which the walking rules otherwise never break.
//
// Placements the bot makes on purpose (a chest, a torch, a tunnel floor)
// run inside placingOnPurpose and are never counted as scaffolding.

const placed = new Map<string, { x: number; y: number; z: number }>();
let onPurpose = 0;
const key = (p: { x: number; y: number; z: number }): string => `${p.x},${p.y},${p.z}`;

/** Runs a deliberate placement (not scaffolding). */
export async function placingOnPurpose<T>(place: () => Promise<T>): Promise<T> {
  onPurpose++;
  try {
    return await place();
  } finally {
    onPurpose--;
  }
}

/** True while a deliberate placement is running. */
export function isPlacingOnPurpose(): boolean {
  return onPurpose > 0;
}

/** Records a block the pathfinder placed to get somewhere. */
export function recordScaffold(p: { x: number; y: number; z: number }): void {
  placed.set(key(p), { x: p.x, y: p.y, z: p.z });
}

/** True for a block the bot placed as scaffolding (it may take it down). */
export function isOwnScaffold(p: { x: number; y: number; z: number }): boolean {
  return placed.has(key(p));
}

/** The block is gone (the bot broke it, or it was replaced). */
export function forgetScaffold(p: { x: number; y: number; z: number }): void {
  placed.delete(key(p));
}

/** Every scaffolding block still standing, highest first. */
export function ownScaffolds(): { x: number; y: number; z: number }[] {
  return [...placed.values()].sort((a, b) => b.y - a.y);
}

/** A new connection: start over (positions from before may not be ours any more). */
export function clearScaffolds(): void {
  placed.clear();
}
