// Path: src/skills/capabilities.ts
// What the bot can do right now (Phase 6), computed on demand from the live
// inventory, the chest index and its remembered places. No cache and no
// timer: 36 slots and a short chest list are cheap to read, and a cached
// "has a stone pickaxe" that outlived a broken pickaxe is exactly the kind of
// stale state that makes a bot do the wrong thing.

import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { loadBed, loadChests } from "../core/session";
import { getPlaces } from "../managers/persistenceManager";
import { currentDimension } from "../actions/perception";

// Tool tiers (core/catalog): wooden 0, golden 1, stone 2, iron 3, diamond 4, netherite 5
export const TIER = { wooden: 0, stone: 2, iron: 3, diamond: 4 } as const;
// (rotten flesh counts: it eats it rather than starve, owner)
const JUNK_FOOD = new Set(["poisonous_potato", "spider_eye", "pufferfish"]);
const TABLE_RANGE = 32;
// Its own tables it walks back to for crafting (actions/crafting FAR_TABLE_RANGE)
const REMEMBERED_TABLE_RANGE = 256;

/** How many of an exact item, or of a Catalog category ("logs", "planks"), it carries. */
export function carried(name: string): number {
  const c = catalog();
  const matches =
    name === "logs" ? (n: string) => c.isLog(n) : name === "planks" ? (n: string) => c.isPlanks(n) : (n: string) => n === name;
  return bot.inventory.items().filter((i) => matches(i.name)).reduce((n, i) => n + i.count, 0);
}

/** The best tier of a tool kind it carries (-1: none). Durability isn't counted: a worn tool still counts until it breaks. */
// Arrows it wants with its bow before it goes out at night
const NIGHT_ARROWS = 16;

/**
 * Well equipped for the night (owner): a full set of armour worn, an iron
 * sword or better, and a bow with arrows (creepers). Then night is like day.
 */
export function wellEquipped(): boolean {
  if (!bot.inventory) return false;
  const slots = (bot.inventory.slots ?? []) as unknown[];
  const worn = [5, 6, 7, 8].every((slot) => slots[slot] != null);
  const count = (name: string): number => bot.inventory.items().filter((i) => i.name === name).reduce((n, i) => n + i.count, 0);
  return worn && toolTier("sword") >= TIER.iron && count("bow") > 0 && count("arrow") >= NIGHT_ARROWS;
}

export function toolTier(kind: "pickaxe" | "axe" | "sword" | "shovel" | "hoe"): number {
  const c = catalog();
  return Math.max(-1, ...bot.inventory.items().filter((i) => c.toolKind(i.name) === kind).map((i) => c.toolTier(i.name)));
}

// Raw meat and fish: food once cooked, not food in stock (owner: the bot must
// keep a stock of cooked food; raw chicken can poison it)
export const RAW_FOOD = new Set(["beef", "porkchop", "mutton", "chicken", "rabbit", "cod", "salmon"]);

/** Food points it carries ready to eat (cooked steak 8, bread 5...): raw meat and junk left out. */
export function foodPoints(): number {
  const foods = (bot.registry.foodsByName ?? {}) as Record<string, { foodPoints?: number }>;
  return bot.inventory
    .items()
    .filter((i) => !JUNK_FOOD.has(i.name) && !RAW_FOOD.has(i.name))
    .reduce((n, i) => n + (foods[i.name]?.foodPoints ?? 0) * i.count, 0);
}

// Tables it couldn't get to lately, by position, until when (set by crafting)
const unreachableTables = new Map<string, number>();
const UNREACHABLE_FOR_MS = 5 * 60 * 1000;
const tableKey = (p: { x: number; y: number; z: number }): string => `${p.x},${p.y},${p.z}`;

/** A table it couldn't get to: left out for a few minutes (crafting and the planner both). */
export function markTableUnreachable(p: { x: number; y: number; z: number }): void {
  unreachableTables.set(tableKey(p), Date.now() + UNREACHABLE_FOR_MS);
}

/** True for a table it couldn't get to a little while ago. */
export const tableUnreachable = (p: { x: number; y: number; z: number }): boolean => (unreachableTables.get(tableKey(p)) ?? 0) > Date.now();

/** True when it carries a crafting table or one stands within reach of a short walk. */
export function hasTableAccess(): boolean {
  if (carried("crafting_table") > 0) return true;
  const id = bot.registry.blocksByName["crafting_table"]?.id;
  if (id !== undefined && bot.findBlock({ matching: id, maxDistance: TABLE_RANGE, useExtraInfo: (b) => !tableUnreachable(b.position) })) return true;
  // One of its own it would walk back to (its shelter's): crafting goes there
  // anyway, so a new table would be wasted planks (it made one 80 blocks out)
  const dim = currentDimension();
  const here = bot.entity?.position;
  // (not one it couldn't get to lately: the planner would wait on it for ever)
  return Boolean(here) && getPlaces("crafting_table").some((t) => (t.dimension ?? dim) === dim && !tableUnreachable(t) && here!.distanceTo(new Vec3(t.x, t.y, t.z)) <= REMEMBERED_TABLE_RANGE);
}

/** Its shelter (the room it dug), in this dimension, if it has one. */
export function shelter(): { x: number; y: number; z: number; details?: Record<string, unknown> } | null {
  const room = getPlaces("basement")
    .filter((p) => p.dimension === currentDimension() && p.details?.["incomplete"] !== true)
    .at(-1);
  if (!room) return null;
  // Its stand cell (never furnished), loaded and filled in (someone built over it): it's gone; not loaded: still believed
  const block = bot.blockAt(new Vec3(room.x, room.y, room.z));
  if (block && block.boundingBox === "block") return null;
  return room;
}

/** Its own bed (its spawn point), still there as far as it can tell. */
export function hasBed(): boolean {
  const bed = loadBed();
  if (!bed || bed.dimension !== currentDimension()) return false;
  const block = bot.blockAt(new Vec3(bed.x, bed.y, bed.z));
  return !block || catalog().isBed(block.name); // not loaded: still believed
}

/** Chests it knows within `radius` of a spot (its shelter). */
export function chestsNear(spot: { x: number; y: number; z: number }, radius = 16): number {
  const dim = currentDimension();
  return loadChests().filter((c) => c.dimension === dim && Math.hypot(c.x - spot.x, c.y - spot.y, c.z - spot.z) <= radius).length;
}

/** Wool of one colour it carries the most of: [colour, count]. */
export function bestWool(): [string, number] | null {
  const counts = new Map<string, number>();
  for (const i of bot.inventory.items()) {
    const m = /^([a-z_]+)_wool$/.exec(i.name);
    if (m) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + i.count);
  }
  // Most of one colour; white on a tie (most sheep are white: it gets to 3 sooner)
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] === "white" ? -1 : b[0] === "white" ? 1 : 0))[0];
  return best ?? null;
}
