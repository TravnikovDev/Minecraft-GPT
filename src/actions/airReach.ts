// Path: src/actions/airReach.ts
// Can a mob get at it? Only through open air: a zombie in the rock behind
// its tunnel's wall, or in a cave it plugged, can't, and doesn't count
// (owner, 2026-11-28: "inside its mine, can it just not care about zombies
// behind the walls?"; game test: "3 hostile mobs near", all behind stone,
// sent it home from the 4th floor to regroup, and held its cave sealing up).
//
// The open air joined to where it stands is flood-filled out to REACH
// blocks: a mob in it can get at it; one outside it can't. Out in the open
// (more than MAX_CELLS of air) everything within reach counts, as before.

import { bot } from "../core/body";
import { Vec3 } from "vec3";

type Pos = { x: number; y: number; z: number };

// How far it looks (the day plan counts mobs within 24)
export const REACH = 26;
// Open air past this many cells: out in the open, every mob counts
export const MAX_CELLS = 6000;
const CACHE_MS = 1000;

const SIX = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** True for a cell a mob can move through: air, water, plants, torches, and doors, trapdoors and gates (zombies break doors). */
export function passable(b: { name: string; boundingBox: string } | null): boolean {
  if (!b) return false; // not loaded: nothing known comes through
  return b.boundingBox === "empty" || /_door$|_trapdoor$|fence_gate$/.test(b.name);
}

/**
 * The open air joined to `from` (its feet and head cells), out to `reach`
 * blocks each way: the cells as keys, or null when it's more than
 * `maxCells` (out in the open). Pure over `at`.
 */
export function airAround(from: Pos[], at: (p: Pos) => { name: string; boundingBox: string } | null, reach = REACH, maxCells = MAX_CELLS): Set<string> | null {
  const o = from[0]!;
  const seen = new Set<string>();
  const queue: Pos[] = [];
  for (const f of from) {
    const k = key(f.x, f.y, f.z);
    if (!seen.has(k)) {
      seen.add(k);
      queue.push(f);
    }
  }
  while (queue.length > 0) {
    const c = queue.shift()!;
    for (const [dx, dy, dz] of SIX) {
      const n = { x: c.x + dx, y: c.y + dy, z: c.z + dz };
      if (Math.abs(n.x - o.x) > reach || Math.abs(n.y - o.y) > reach || Math.abs(n.z - o.z) > reach) continue;
      const k = key(n.x, n.y, n.z);
      if (seen.has(k) || !passable(at(n))) continue;
      seen.add(k);
      if (seen.size > maxCells) return null;
      queue.push(n);
    }
  }
  return seen;
}

/** True when a mob at `pos` (its feet) is in that air (`air` null: out in the open, it is). Pure. */
export function inAir(air: Set<string> | null, pos: Pos): boolean {
  if (air === null) return true;
  const x = Math.floor(pos.x);
  const y = Math.floor(pos.y);
  const z = Math.floor(pos.z);
  // Its feet or head cell
  return air.has(key(x, y, z)) || air.has(key(x, y + 1, z));
}

let cached: { at: string; when: number; air: Set<string> | null } | null = null;

/** The open air joined to where it stands now (cached a second). */
function airHere(): Set<string> | null {
  const p = bot.entity.position.floored();
  const at = key(p.x, p.y, p.z);
  if (cached && cached.at === at && Date.now() - cached.when < CACHE_MS) return cached.air;
  const air = airAround([p, p.offset(0, 1, 0)], (c) => bot.blockAt(new Vec3(c.x, c.y, c.z)));
  cached = { at, when: Date.now(), air };
  return air;
}

/** True when this mob can get at it through open air (always, out in the open or past REACH). */
export function mobCanReachMe(e: { position: Pos }): boolean {
  // Nothing known of the world round it (not joined yet): every mob counts
  if (!bot.entity || typeof bot.blockAt !== "function") return true;
  const me = bot.entity.position;
  if (Math.abs(e.position.x - me.x) > REACH || Math.abs(e.position.y - me.y) > REACH || Math.abs(e.position.z - me.z) > REACH) return true;
  return inAir(airHere(), e.position);
}

/** Forgets the cached air (tests). */
export function resetAirReach(): void {
  cached = null;
}
