// Path: src/actions/hunting.ts
// Hunting like a player: look around (what it can see within 60 blocks, plus
// what it hears close by), pick out the common game animals, hunt that group
// rather than one animal. No breeding pair is left in the wild (owner: they
// wander off and are never bred, and the game slowly spawns new ones anyway;
// it walked 100 blocks to pairs and came back with nothing, eleven times).
// The planning is pure (plain data in, plain data out) so it can be tested
// without a game; the scan reads the world.

import type { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { canSeePoint, type SightWorld } from "./sight";

/** Animals hunted when the owner doesn't name one. */
export const GAME_ANIMALS = new Set(["cow", "pig", "sheep", "chicken", "rabbit"]);
/** How far it looks, and how close it notices animals it can't see. */
export const SIGHT_RANGE = 60;
export const HEARING_RANGE = 16;
/**
 * How far it knows about animals: everything the server tells it about (it
 * hears them, sees them from a hill...). Out of sight, it walks toward them
 * until they are in sight, as a player follows the "baa".
 */
export const KNOWN_RANGE = 200;
/** One animal as the planner sees it. */
export type Prey = { id: number; name: string; distance: number; baby: boolean; named: boolean };

/** What a hunt will take: the most of each kind, and the total. */
export type HuntPlan = { seen: Map<string, number>; take: Map<string, number>; total: number };

/** A grown, unnamed animal of the wanted kind (named ones are someone's pets). */
export function isGame(p: Prey, mobType: string | null): boolean {
  if (p.baby || p.named) return false;
  return mobType ? p.name === mobType : GAME_ANIMALS.has(p.name);
}

/**
 * Decides what to hunt from the animals found (grown, unnamed game).
 * - No count: every one it found.
 * - A count from the owner ("kill 3 sheep"): up to that many.
 * - `upTo` (its food stock): at most that many.
 */
export function planHunt(found: Prey[], mobType: string | null, count: number | null, upTo: number | null = null): HuntPlan {
  const seen = new Map<string, number>();
  for (const p of found) if (isGame(p, mobType)) seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
  const take = new Map(seen);
  const available = [...take.values()].reduce((a, b) => a + b, 0);
  const total = Math.min(available, count ?? upTo ?? available);
  return { seen, take, total };
}

/** "3 cows, 2 sheep and 1 chicken". */
export function countList(counts: Map<string, number>): string {
  const parts = [...counts.entries()]
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${n} ${plural(name.replace(/_/g, " "), n)}`);
  return parts.length < 2 ? (parts[0] ?? "nothing") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

function plural(name: string, n: number): string {
  if (n === 1 || /(sheep|fish|salmon|cod|mutton|beef|porkchop|wool|leather)$/.test(name)) return name;
  return name.endsWith("s") ? name : `${name}s`;
}

/** Reads one entity into the planner's terms. */
function toPrey(e: Entity, distance: number): Prey {
  const keys = (bot.registry.entitiesByName[e.name ?? ""]?.metadataKeys ?? []) as string[];
  const at = (key: string): unknown => {
    const i = keys.indexOf(key);
    return i >= 0 ? e.metadata?.[i] : undefined;
  };
  return { id: e.id, name: e.name ?? "", distance, baby: Boolean(at("baby")), named: Boolean(at("custom_name")) };
}

/**
 * The animals a player standing here would know about: in sight within
 * SIGHT_RANGE, or close enough to hear. Nearest first.
 */
export function lookForAnimals(): Prey[] {
  const eyes = bot.entity.position.offset(0, 1.62, 0);
  const world = bot.world as unknown as SightWorld;
  const found: Prey[] = [];
  const hidden: string[] = [];
  for (const e of Object.values(bot.entities)) {
    if (e === bot.entity || !e.name || !catalog().isHuntable(e.name)) continue; // animals, by game data
    const distance = e.position.distanceTo(bot.entity.position);
    if (distance > SIGHT_RANGE) continue;
    const middle = e.position.offset(0, (e.height ?? 1) / 2, 0);
    if (distance <= HEARING_RANGE || canSeePoint(world, eyes, middle, SIGHT_RANGE)) found.push(toPrey(e, distance));
    else hidden.push(`${e.name} ${Math.round(distance)}m`);
  }
  // Why "I don't see any": what the server sent that was out of sight
  console.log(`Looking for animals: ${found.length} in sight or earshot${hidden.length ? `, out of sight: ${hidden.join(", ")}` : ""}.`);
  return found.sort((a, b) => a.distance - b.distance);
}

/**
 * True when nothing solid is over `pos` up to `height` blocks (leaves are
 * fine: under a tree is still out in the open; unloaded counts as open).
 * Pure over `look`.
 */
export function skyAbove(pos: { x: number; y: number; z: number }, look: (x: number, y: number, z: number) => { name: string; boundingBox: string } | null, height = 64): boolean {
  const x = Math.floor(pos.x);
  const z = Math.floor(pos.z);
  for (let y = Math.floor(pos.y) + 1; y <= Math.floor(pos.y) + height; y++) {
    const b = look(x, y, z);
    if (b && b.boundingBox === "block" && !b.name.endsWith("_leaves")) return false;
  }
  return true;
}

/**
 * Every animal the server reports within `range` (in sight or not), nearest
 * first, out in the open only: one in a cave is no food to go for (game
 * test: it dug a 147-block tunnel down to y 7 after a chicken in a cave).
 */
export function knownAnimals(range = KNOWN_RANGE): Prey[] {
  const me = bot.entity.position;
  const look = (x: number, y: number, z: number) => bot.blockAt(new Vec3(x, y, z));
  return Object.values(bot.entities)
    .filter((e) => e !== bot.entity && !!e.name && catalog().isHuntable(e.name) && e.position.distanceTo(me) <= range)
    .filter((e) => skyAbove(e.position, look))
    .map((e) => toPrey(e, e.position.distanceTo(me)))
    .sort((a, b) => a.distance - b.distance);
}
