// Path: src/skills/explore.ts
// Looking farther away when nothing is left nearby (Phase 6): the animals
// around the shelter are hunted out, so a player walks off to find more
// instead of standing hungry. Legs of about 48 blocks in a direction not
// tried lately, until what it's looking for is in sight; a few legs at most.

import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { isCommandCancelled } from "../core/commandContext";
import { chatter } from "../core/narrator";
import { travelToResult } from "../actions/movement";

const LEG = 48;
// Found when the server reports one this close: the hunt then walks to it
const SIGHT = 200;
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

/** Animals worth hunting are in sight. */
export const animalsInSight = (): boolean => inSight((n) => catalog().isHuntable(n));

/**
 * Walks off in legs until `found()` (animals in sight...), trying directions
 * it hasn't tried lately first. Returns whether it found it.
 */
export async function exploreFor(what: string, found: () => boolean, legs = 3): Promise<boolean> {
  if (found()) return true;
  const now = Date.now();
  const order = [...DIRECTIONS].sort((a, b) => (tried.get(a[0]) ?? 0) - (tried.get(b[0]) ?? 0) || Math.random() - 0.5);
  const [name, dx, dz] = order[0]!;
  tried.set(name, now);
  chatter(`No ${what} around here; I'll look farther ${name}.`, "exploring");
  for (let leg = 1; leg <= legs; leg++) {
    if (isCommandCancelled()) return false;
    const from = bot.entity.position;
    const step = LEG / Math.hypot(dx, dz);
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
