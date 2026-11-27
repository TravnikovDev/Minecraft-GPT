// Path: src/skills/explore.ts
// Looking farther away when nothing is left nearby (Phase 6): the animals
// around the shelter are hunted out, so a player walks off to find more
// instead of standing hungry. Legs of about 48 blocks in a direction not
// tried lately, until what it's looking for is in sight; a few legs at most.

import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { isGame, knownAnimals } from "../actions/hunting";
import { isCommandCancelled } from "../core/commandContext";
import { chatter } from "../core/narrator";
import { travelToResult } from "../actions/movement";

const LEG = 48;
// Found when the server reports one this close: the hunt then walks to it
const SIGHT = 200;
// Animals: looked for this far (owner: scan 150 blocks round), and with
// none, a walk of this far in one direction over dry land to look (owner:
// up to 75 blocks, not over water)
export const ANIMAL_SCAN = 150;
export const ANIMAL_WALK = 75;
const DIRECTIONS: [string, number, number][] = [
  ["north", 0, -1], ["north-east", 1, -1], ["east", 1, 0], ["south-east", 1, 1],
  ["south", 0, 1], ["south-west", -1, 1], ["west", -1, 0], ["north-west", -1, -1],
];
const tried = new Map<string, number>();

/** True when an entity matching `test` is within sight. */
export function inSight(test: (name: string) => boolean, radius = SIGHT): boolean {
  const me = bot.entity?.position;
  if (!me) return false;
  return Object.values(bot.entities).some((e) => e !== bot.entity && !!e.name && test(e.name) && e.position.distanceTo(me) <= radius);
}

/**
 * Animals it would really take are about: the hunt's own test (grown, not
 * named, a food animal), as far as the server tells it. Game test: a baby or
 * a squid somewhere counted as "animals here", so it never went looking,
 * and the hunt found none to take: no food, down to 0 food points.
 */
export const animalsInSight = (): boolean => {
  if (!bot.entity) return false;
  return knownAnimals(ANIMAL_SCAN).some((p) => isGame(p, null));
};

/** What the ground at a column is, as the dry-land check sees it: "water", "land" or null (not loaded). */
export type Ground = "water" | "land" | null;

/**
 * The direction to walk to look: one not tried lately first, then the one
 * with the least water on the way (owner: not over water; a swim far out
 * drowns it or strands it), sampled every 8 blocks up to `reach`. Pure over
 * `groundAt` and `triedAt`.
 */
export function dryDirection(from: { x: number; z: number }, reach: number, groundAt: (x: number, z: number) => Ground, triedAt: (name: string) => number): [string, number, number] {
  const wet = (dx: number, dz: number): number => {
    let n = 0;
    const unit = 1 / Math.hypot(dx, dz);
    for (let d = 8; d <= reach; d += 8) if (groundAt(Math.floor(from.x + dx * unit * d), Math.floor(from.z + dz * unit * d)) === "water") n++;
    return n;
  };
  const scored = DIRECTIONS.map((dir) => ({ dir, wet: wet(dir[1], dir[2]), tried: triedAt(dir[0]) }));
  // Dry ones first (no water at all), then least water; among those, not tried lately
  scored.sort((a, b) => Number(a.wet > 0) - Number(b.wet > 0) || a.tried - b.tried || a.wet - b.wet);
  return scored[0]!.dir;
}

/** The ground at the top of a column near its own height (water, land, or not loaded). */
function groundAt(x: number, z: number): Ground {
  const y0 = Math.floor(bot.entity.position.y);
  for (let y = y0 + 16; y >= y0 - 16; y--) {
    const b = bot.blockAt(new Vec3(x, y, z));
    if (!b) return null;
    if (b.name === "water" || b.name === "lava") return "water";
    if (b.boundingBox === "block" && !b.name.endsWith("_leaves")) return "land";
  }
  return null;
}

/**
 * Walks off in legs (`leg` blocks each) until `found()` (animals in
 * sight...), in a direction over dry land not tried lately. Returns whether
 * it found it.
 */
export async function exploreFor(what: string, found: () => boolean, legs = 3, leg = LEG): Promise<boolean> {
  if (found()) return true;
  const now = Date.now();
  const [name, dx, dz] = dryDirection(bot.entity.position, legs * leg, groundAt, (n) => tried.get(n) ?? 0);
  tried.set(name, now);
  chatter(`No ${what} around here; I'll look farther ${name}.`, "exploring");
  for (let leg = 1; leg <= legs; leg++) {
    if (isCommandCancelled()) return false;
    const from = bot.entity.position;
    const step = leg / Math.hypot(dx, dz);
    const target = new Vec3(from.x + dx * step, from.y, from.z + dz * step);
    const walked = await travelToResult(() => ({ x: target.x, y: null, z: target.z }), { range: 4 });
    if (found()) return true;
    if (!walked.ok) {
      console.log(`Exploring ${name} for ${what}: stopped after leg ${leg}.`);
      return false;
    }
  }
  console.log(`Exploring ${name} for ${what}: none in ${legs} legs.`);
  return false;
}

/** Forgets which directions it tried (tests). */
export function resetExploring(): void {
  tried.clear();
}
