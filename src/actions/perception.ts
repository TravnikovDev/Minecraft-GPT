// Path: src/actions/perception.ts
// What the bot knows about the world right now (Phase 5), read on demand from
// the live game mirror instead of copied into a store that goes stale. Each
// read says where it came from and how old it is, and says "unknown" honestly
// (the owner is out of range, nothing was ever seen) instead of guessing.
//
// - owner(): visible / online but out of range (with where they were last) / offline
// - threats(): the hostile mobs the combat reflex would fight (one definition)
// - vitals(), sky(): health, food, air; time of day and weather, straight from the mirror
// - sightings: resources noticed while working (ores, logs), kept as hints for 10 minutes
// - currentDimension(): the one place that reads the dimension

import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { OWNER_USERNAME } from "../config/env";
import { loadOwnerPosition } from "../core/session";
import { getPriorityTargets } from "./combat";
import { mobCanReachMe } from "./airReach";

export type Known<T> = { known: true; value: T; at: number; source: string } | { known: false; why: string; since?: number };

const known = <T>(value: T, source: string, at = Date.now()): Known<T> => ({ known: true, value, at, source });
const unknown = <T>(why: string, since?: number): Known<T> => ({ known: false, why, ...(since ? { since } : {}) });

/** The dimension the bot is in (overworld, the_nether, the_end). */
export function currentDimension(): string {
  return ((bot.game as { dimension?: string } | undefined)?.dimension ?? "overworld").replace(/^minecraft:/, "");
}

// --- The owner -------------------------------------------------------------------

export type OwnerState =
  | { state: "visible"; position: Vec3; distance: number }
  | { state: "out of range"; lastKnown: { x: number; y: number; z: number; at: number } | null }
  | { state: "offline" };

/** Where the owner is, as far as the bot can tell. */
export function owner(): Known<OwnerState> {
  const wanted = OWNER_USERNAME.toLowerCase();
  const name = Object.keys(bot.players ?? {}).find((n) => n.toLowerCase() === wanted);
  if (!name) return known({ state: "offline" }, "player list");
  const entity = bot.players[name]?.entity;
  if (entity && bot.entity) {
    return known({ state: "visible", position: entity.position.clone(), distance: entity.position.distanceTo(bot.entity.position) }, "seen");
  }
  const last = loadOwnerPosition();
  return known({ state: "out of range", lastKnown: last }, last ? "last seen or told" : "player list", last?.at);
}

// --- Threats ---------------------------------------------------------------------

export type Threat = { name: string; distance: number };

/** Hostile mobs within `range`, most dangerous first: exactly the ones the combat reflex fights (creepers apart). */
export function threats(range = 16): Known<Threat[]> {
  if (!bot.entity) return unknown("not in the world");
  const mobs = getPriorityTargets(range).map((e) => ({ name: e.name ?? "mob", distance: e.position.distanceTo(bot.entity.position) }));
  const creepers = Object.values(bot.entities)
    .filter((e) => e.name === "creeper" && e.position.distanceTo(bot.entity.position) <= range && mobCanReachMe(e))
    .map((e) => ({ name: "creeper", distance: e.position.distanceTo(bot.entity.position) }));
  return known([...creepers, ...mobs], "seen");
}

// --- Vitals and the sky ----------------------------------------------------------------

export type Vitals = { health: number; food: number; saturation: number; air: number };

/** Health, food, saturation and air (out of 20, 20, 20 and 300 ticks), live. */
export function vitals(): Known<Vitals> {
  if (!bot.entity) return unknown("not in the world");
  const air = (bot.entity.metadata as unknown[] | undefined)?.[1];
  return known(
    { health: Math.round(bot.health ?? 0), food: bot.food ?? 0, saturation: Math.round(bot.foodSaturation ?? 0), air: typeof air === "number" ? air : 300 },
    "server"
  );
}

export type Sky = { timeOfDay: number; phase: "day" | "dusk" | "night" | "dawn"; raining: boolean; thundering: boolean };

/** Time of day and weather, live. */
export function sky(): Known<Sky> {
  const t = bot.time?.timeOfDay;
  if (t === undefined) return unknown("no time from the server yet");
  const phase = t < 12000 ? "day" : t < 13000 ? "dusk" : t < 23000 ? "night" : "dawn";
  return known({ timeOfDay: t, phase, raining: Boolean(bot.isRaining), thundering: (bot.thunderState ?? 0) > 0 }, "server");
}

// --- Sightings: resources noticed while working ---------------------------------

const SIGHTING_TTL_MS = 10 * 60_000;
const MAX_PER_KIND = 32;
type Sighting = { x: number; y: number; z: number; dimension: string; at: number };
const seen = new Map<string, Sighting[]>();

/** Notes where it saw a resource (an ore, a log) while doing something else. Hints, not facts. */
export function recordSighting(kind: string, at: { x: number; y: number; z: number }): void {
  const list = (seen.get(kind) ?? []).filter((s) => !(s.x === at.x && s.y === at.y && s.z === at.z));
  list.push({ x: at.x, y: at.y, z: at.z, dimension: currentDimension(), at: Date.now() });
  seen.set(kind, list.slice(-MAX_PER_KIND));
}

/** Where it noticed `kind` recently in this dimension, nearest first. */
export function sightings(kind: string): Sighting[] {
  const now = Date.now();
  const here = bot.entity?.position;
  const fresh = (seen.get(kind) ?? []).filter((s) => now - s.at < SIGHTING_TTL_MS && s.dimension === currentDimension());
  seen.set(kind, fresh);
  return here ? fresh.sort((a, b) => here.distanceTo(new Vec3(a.x, a.y, a.z)) - here.distanceTo(new Vec3(b.x, b.y, b.z))) : fresh;
}

/** A new connection: sightings from before may be out of date (or another world). */
export function resetPerception(): void {
  seen.clear();
}

// --- Saying it ------------------------------------------------------------------

/** "3 min ago", "2 h ago". */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
