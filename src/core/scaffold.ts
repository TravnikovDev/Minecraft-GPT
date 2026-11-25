// Path: src/core/scaffold.ts
// Blocks the bot put down only to get somewhere: the pathfinder's pillars
// (to reach the top of a tall tree) and bridges. A player takes those down
// again; the bot may break these (and only these) even though they're
// cobblestone or dirt, which the walking rules otherwise never break.
//
// Placements the bot makes on purpose (a chest, a torch, a tunnel floor)
// run inside placingOnPurpose and are never counted as scaffolding.

import { Vec3 } from "vec3";
import { bot } from "./body";
import { on } from "./events";
import { forbiddenAt } from "./forbidden";

type Placed = { x: number; y: number; z: number; name: string | null };
const placed = new Map<string, Placed>();
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

/** Records a block the pathfinder placed to get somewhere, and what it was (cobblestone, dirt). */
export function recordScaffold(p: { x: number; y: number; z: number }, name: string | null = null): void {
  placed.set(key(p), { x: p.x, y: p.y, z: p.z, name });
}

/**
 * True for a block the bot placed as scaffolding and that is still that
 * block (it may take it down). A different block there now (the owner built
 * on the spot) is not its own: that spot is forgotten.
 */
export function isOwnScaffold(p: { x: number; y: number; z: number }, nameNow?: string): boolean {
  const entry = placed.get(key(p));
  if (!entry) return false;
  if (entry.name === null) return true; // placed before names were kept
  const now = nameNow ?? bot.blockAt?.(new Vec3(p.x, p.y, p.z))?.name;
  if (now === undefined) return true; // not loaded: unknown, keep it
  if (now === entry.name) return true;
  placed.delete(key(p));
  return false;
}

/** The block is gone (the bot broke it, or it was replaced). */
export function forgetScaffold(p: { x: number; y: number; z: number }): void {
  placed.delete(key(p));
}

// --- Doors: blocks it closes its shelter with -----------------------------------
// Not scaffolding (the idle cleanup never takes them down), but the walking
// rules may dig through them, so "come here" at night gets it out.
const doors = new Map<string, Placed>();

/** Records a block it closed its shelter with. */
export function markDoor(p: { x: number; y: number; z: number }, name: string | null): void {
  doors.set(key(p), { x: p.x, y: p.y, z: p.z, name });
}

/** Forgets a door block (opened, or someone else changed it). */
export function forgetDoor(p: { x: number; y: number; z: number }): void {
  doors.delete(key(p));
}

/** True for its own scaffolding or shelter door, still what it placed: the walking rules may break it. */
export function isOwnBlock(p: { x: number; y: number; z: number }, nameNow?: string): boolean {
  if (isOwnScaffold(p, nameNow)) return true;
  const door = doors.get(key(p));
  if (!door) return false;
  const now = nameNow ?? bot.blockAt?.(new Vec3(p.x, p.y, p.z))?.name;
  return door.name === null || now === undefined || now === door.name;
}

/** Every scaffolding block still standing (and still what it placed), highest first. */
export function ownScaffolds(): { x: number; y: number; z: number }[] {
  return [...placed.values()]
    .filter((p) => isOwnScaffold(p) && !forbiddenAt(p)) // inside a keep-out area: left alone
    .map(({ x, y, z }) => ({ x, y, z }))
    .sort((a, b) => b.y - a.y);
}

/** A new connection: start over (positions from before may not be ours any more). */
export function clearScaffolds(): void {
  placed.clear();
  doors.clear();
}

// Someone else changed the block (the owner broke it, or built on the spot):
// it's not the bot's scaffolding any more. The bot's own digs and placements
// don't count (they're marked self-caused, or recorded right after).
on("block:changed", ({ position, selfCaused }) => {
  if (!selfCaused) {
    forgetScaffold(position);
    forgetDoor(position);
  }
});
