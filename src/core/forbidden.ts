// Path: src/core/forbidden.ts
// Places the bot must not dig or build in (Phase 5): areas the owner marked
// ("keep out of here"), and areas the server protects (a land claim, spawn
// protection). Saved with the rest of its memory. The checked primitives
// refuse to dig or place inside one, the walking rules never dig or build
// there, and the finders skip targets inside one.
//
// A server area is noticed only from what the server does, not from any
// "refused": a block it dug coming back, or a block it placed not staying,
// twice within a few blocks and a couple of minutes. Falling sand, flowing
// water or a bad support once is not a claim.

import { bot } from "./body";
import { getMemory, updateMemory } from "../managers/persistenceManager";
import type { MemoryType } from "../schemas/types";

export type ForbiddenArea = NonNullable<MemoryType["forbidden"]>[number];
type Pos = { x: number; y: number; z: number };

const REVERT_RADIUS = 8;
const REVERT_WINDOW_MS = 2 * 60_000;
const SERVER_AREA_RADIUS = 4;
const SERVER_AREA_MS = 30 * 60_000;

const reverts: (Pos & { at: number })[] = [];
const changeHooks: Array<() => void> = [];

const dimension = (): string => ((bot.game as { dimension?: string } | undefined)?.dimension ?? "overworld").replace(/^minecraft:/, "");
const distance = (a: Pos, b: Pos): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Runs when the areas change (the walking rules plan again). */
export function onForbiddenChange(hook: () => void): void {
  changeHooks.push(hook);
}

/** The areas in force now (expired server areas are dropped). */
export function forbiddenAreas(): ForbiddenArea[] {
  const now = Date.now();
  return (getMemory().forbidden ?? []).filter((a) => a.until === undefined || a.until > now);
}

/** The area `pos` lies in (in the current dimension), or null. */
export function forbiddenAt(pos: Pos): ForbiddenArea | null {
  const here = dimension();
  return forbiddenAreas().find((a) => a.dimension === here && distance(a, pos) <= a.radius) ?? null;
}

async function save(areas: ForbiddenArea[]): Promise<void> {
  await updateMemory({ forbidden: areas });
  for (const hook of changeHooks) {
    try {
      hook();
    } catch (error) {
      console.error("Forbidden-area hook failed:", error);
    }
  }
}

/** The owner marks an area (default 16 blocks around `center`). */
export async function markForbidden(center: Pos, radius: number, reason: string, source: "owner" | "server" = "owner", forMs?: number): Promise<void> {
  const area: ForbiddenArea = {
    x: Math.floor(center.x),
    y: Math.floor(center.y),
    z: Math.floor(center.z),
    radius,
    dimension: dimension(),
    reason,
    source,
    ...(forMs ? { until: Date.now() + forMs } : {}),
  };
  console.log(`Keeping out of ${area.x}, ${area.y}, ${area.z} (radius ${radius}): ${reason}.`);
  await save([...forbiddenAreas(), area]);
}

/** Clears the areas covering `pos` (the owner: "you can work here again"). Returns how many. */
export async function clearForbiddenAt(pos: Pos): Promise<number> {
  const all = forbiddenAreas();
  const here = dimension();
  const kept = all.filter((a) => !(a.dimension === here && distance(a, pos) <= a.radius));
  if (kept.length !== all.length) await save(kept);
  return all.length - kept.length;
}

/**
 * The server put a block back (it dug it, and it came back; or placed it,
 * and it didn't stay). Twice close together: a protected area, kept out of
 * for a while. Returns true when it just marked one.
 */
export async function noteRevert(pos: Pos): Promise<boolean> {
  const now = Date.now();
  while (reverts.length > 0 && now - reverts[0]!.at > REVERT_WINDOW_MS) reverts.shift();
  const near = reverts.filter((r) => distance(r, pos) <= REVERT_RADIUS);
  reverts.push({ x: pos.x, y: pos.y, z: pos.z, at: now });
  if (near.length === 0 || forbiddenAt(pos)) return false;
  const all = [...near, pos];
  const center = { x: all.reduce((s, p) => s + p.x, 0) / all.length, y: all.reduce((s, p) => s + p.y, 0) / all.length, z: all.reduce((s, p) => s + p.z, 0) / all.length };
  await markForbidden(center, SERVER_AREA_RADIUS, "the server keeps putting blocks back (a protected area?)", "server", SERVER_AREA_MS);
  return true;
}

/** Forgets recent reverts (tests). */
export function clearReverts(): void {
  reverts.length = 0;
}
