// src/actions/movement.ts

import pf from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import * as world from "./world.js";
import { bot } from "../core/body";
import { __actionsDelay, getRandomInt } from "../utils/utility.js";
import { isCommandCancelled } from "../core/commandContext";
import { isAnyReflexActive, waitForReflexes } from "../core/reflexes";
import { goTo, knownBlock } from "../core/primitives";
import { describeFailure, fail, ok, wasStopped, type ActionResult } from "../core/result";
import { pathing } from "../core/plugins";
import { BOAT_TRIP_BLOCKS, crossWaterByBoat, ensureBoat, hasBoat, waterAhead } from "./boat";

/** Distance beyond which a trip is walked in legs instead of one path search. */
export const LONG_TRIP_BLOCKS = 48;
const LEG_BLOCKS = 48;
const MAX_LEG_FAILURES = 6;
const MAX_BOAT_CROSSINGS = 4; // per trip

type XZ = { x: number; z: number };
const distXZ = (a: XZ, b: XZ): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Travels to a far target by walking short legs toward it, so each path search
 * stays small. On a failed leg it tries sidesteps to route around obstacles.
 * `getTarget` is re-read every leg, so a moving target (a player) works too.
 * `onProgress` fires at 20%, 40%, 60% and 80% of the distance.
 * Returns whether it arrived; travelToResult says why not.
 */
export async function travelTo(
  getTarget: () => { x: number; y: number | null; z: number } | null,
  options: { range?: number; onProgress?: (percent: number) => void } = {}
): Promise<boolean> {
  return (await travelToResult(getTarget, options)).ok;
}

/** travelTo, with the reason when it didn't arrive. */
// A trip this long from home counts as "away", out over the land
const AWAY_BLOCKS = 32;

/**
 * Whether a trip should start by going up and out of its home: it's below
 * the top of its stairs (in its shelter or its mine, near home), and the
 * place it's going is on the surface (no height given, or not far below the
 * top of its stairs) and far. Pure.
 */
export function startsOutByTheFront(me: { x: number; y: number; z: number }, top: { x: number; y: number; z: number }, target: { x: number; z: number; y: number | null }, distance: number): boolean {
  if (distance < AWAY_BLOCKS) return false;
  const nearHome = Math.hypot(me.x - top.x, me.z - top.z) <= 64;
  const belowHome = me.y < top.y - 2;
  const toSurface = target.y === null || target.y >= top.y - 8;
  return nearHome && belowHome && toSurface;
}

/** Up its stairs to the top (out the front door) when the trip calls for it. */
async function outByTheFront(target: { x: number; y: number | null; z: number }, distance: number): Promise<void> {
  const { shelterLayout } = await import("./building");
  const top = shelterLayout()?.start;
  if (!top || !startsOutByTheFront(bot.entity.position, top, target, distance)) return;
  console.log(`Long trip: out by the front of my home first (up to ${top.x}, ${top.y}, ${top.z}).`);
  const out = await goTo(new pf.goals.GoalNear(top.x, top.y, top.z, 1));
  if (!out.ok) console.log(`Long trip: couldn't get out by the front (${out.ok ? "" : out.detail}); going as I can.`);
}

export async function travelToResult(
  getTarget: () => { x: number; y: number | null; z: number } | null,
  options: { range?: number; onProgress?: (percent: number) => void } = {}
): Promise<ActionResult> {
  const range = options.range ?? 2;
  const first = getTarget();
  if (!first) return fail("not_found", "no target to travel to");
  const total = Math.max(1, distXZ(bot.entity.position, first));
  const reported = new Set<number>();
  const savedThink = pathing.thinkTimeout;
  // A leg of rough terrain can need more than the 5 s default, but planning
  // must stay under the 8 s a walk may stand still (core/primitives)
  pathing.thinkTimeout = 6000;
  let failures = 0;
  let crossings = 0;
  let last: ActionResult = fail("unreachable", "no way found");

  // A long trip: take a boat along for any water on the way (much faster
  // than swimming, and no drowning)
  if (total >= BOAT_TRIP_BLOCKS && !hasBoat()) {
    console.log("Long trip: making a boat first.");
    if (!(await ensureBoat())) console.log("Long trip: no boat (no wood); going without.");
    if (isCommandCancelled()) return fail("aborted", "stopped");
  }

  // Out by the front first: a long trip to somewhere on the surface, starting
  // down in its shelter or its mine, goes up its stairs and over the land,
  // not through its mine and on through the rock (game test: off to a
  // chicken in a field it went down its mine and dug along at y 5)
  await outByTheFront(first, total);

  try {
    while (failures < MAX_LEG_FAILURES) {
      if (isCommandCancelled()) return fail("aborted", "stopped");
      await waitForReflexes(isCommandCancelled); // creepers, mobs and running out of air come first
      const target = getTarget();
      if (!target) return fail("not_found", "lost the target");
      const pos = bot.entity.position;
      const remaining = distXZ(pos, target);

      const percent = Math.floor(((total - remaining) / total) * 5) * 20;
      if (percent >= 20 && percent < 100 && !reported.has(percent)) {
        reported.add(percent);
        options.onProgress?.(percent);
      }

      // Close enough horizontally: arrived. The owner's y is often approximate
      // (e.g. 100 for ground at 70), so never insist on reaching an exact height.
      if (remaining <= range + 1) return ok();

      // Water in the way: row across instead of swimming
      if (remaining > 24 && crossings < MAX_BOAT_CROSSINGS && hasBoat() && waterAhead(target)) {
        crossings++;
        if (await crossWaterByBoat(target)) {
          failures = 0;
          continue;
        }
        if (isCommandCancelled()) return fail("aborted", "stopped");
      }

      // Last stretch: walk to the spot on the ground. Use the height only when
      // it is close to the bot's own level; otherwise aim for x/z alone.
      if (remaining <= LEG_BLOCKS) {
        const useHeight = target.y !== null && Math.abs(target.y - pos.y) <= 6;
        const goal = useHeight
          ? new pf.goals.GoalNear(target.x, target.y!, target.z, range)
          : new pf.goals.GoalNearXZ(target.x, target.z, range);
        last = await goTo(goal);
        if (last.ok) return last;
        if (wasStopped(last)) return last;
        if (isAnyReflexActive()) continue; // interrupted by a reflex, not a real failure
        failures++;
        console.log(`travelTo final leg failed (${describeFailure(last)}), retry ${failures}`);
        continue;
      }

      // A leg toward the target; after a failure try sidesteps left/right
      const side = failures === 0 ? 0 : (failures % 2 ? 1 : -1) * 0.5 * Math.ceil(failures / 2);
      const angle = Math.atan2(target.z - pos.z, target.x - pos.x) + side;
      const step = failures > 0 ? LEG_BLOCKS / 2 : LEG_BLOCKS;
      const legX = Math.round(pos.x + Math.cos(angle) * step);
      const legZ = Math.round(pos.z + Math.sin(angle) * step);
      last = await goTo(new pf.goals.GoalNearXZ(legX, legZ, 3));
      if (last.ok) {
        failures = 0;
        continue;
      }
      if (wasStopped(last)) return last;
      if (isAnyReflexActive()) continue; // interrupted by a reflex, not a real failure
      failures++;
      console.log(`travelTo leg failed (${describeFailure(last)}), retry ${failures}`);
    }
    return last;
  } finally {
    pathing.thinkTimeout = savedThink;
  }
}

/** Walks to within `minDistance` of a spot. Returns whether it got there (the reason is logged). */
export async function goToPosition(x: number, y: number, z: number, minDistance = 2): Promise<boolean> {
  return (await goToPositionResult(x, y, z, minDistance)).ok;
}

/** goToPosition, with the reason when it didn't get there. */
export async function goToPositionResult(x: number, y: number, z: number, minDistance = 2): Promise<ActionResult> {
  const result = await goTo(new pf.goals.GoalNear(x, y, z, minDistance));
  if (result.ok) console.log(`You have reached at ${x}, ${y}, ${z}.`);
  else console.log(`Failed to go to position: ${describeFailure(result)}`);
  return result;
}

export async function goToNearestBlock(blockType: string, minDistance = 2, range = 64): Promise<boolean> {
  const MAX_RANGE = 512;
  if (range > MAX_RANGE) {
    console.log(`Maximum search range capped at ${MAX_RANGE}.`);
    range = MAX_RANGE;
  }
  const block = world.getNearestBlock(blockType, range);
  if (!block) {
    console.log(`Could not find any ${blockType} in ${range} blocks.`);
    return false;
  }
  console.log(`Found ${blockType} at ${block.position}.`);
  return goToPosition(block.position.x, block.position.y, block.position.z, minDistance);
}

/** Walks up to a player. Returns whether it got there (the reason is logged). */
export async function goToPlayer(username: string, distance = 3): Promise<boolean> {
  const playerEntity = bot.players[username]?.entity;
  if (!playerEntity) {
    console.log(`Could not find ${username}.`);
    return false;
  }
  // Fixed legs toward where the player is now, re-aimed each leg. A
  // GoalFollow throws its path away whenever the player moves a couple of
  // blocks, so with the owner walking about it kept planning and never set
  // off (20 s of standing still, then "stuck")
  const result = await travelToResult(() => {
    const p = bot.players[username]?.entity?.position;
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  }, { range: distance });
  if (!result.ok) {
    console.log(`Couldn't get to ${username}: ${describeFailure(result)}`);
    return false;
  }
  console.log(`You have reached ${username}.`);
  return true;
}

export async function followPlayer(
  username: string,
  distance = 4
): Promise<boolean> {
  const playerEntity = bot.players[username]?.entity;
  if (!playerEntity) {
    return false;
  }

  pathing.setGoal(new pf.goals.GoalFollow(playerEntity, distance), true);
  console.log(`You are now actively following player ${username}.`);

  return true;
}

/** Walks to a random spot about `distance` blocks away on known, dry ground. */
export async function moveAway(distance: number): Promise<boolean> {
  const pos = bot.entity.position;
  for (let attempt = 0; attempt < 20; attempt++) {
    const newX = Math.floor(pos.x + ((distance * getRandomInt(0, 100)) / 100) * (getRandomInt(0, 1) ? 1 : -1));
    const newZ = Math.floor(pos.z + ((distance * getRandomInt(0, 100)) / 100) * (getRandomInt(0, 1) ? 1 : -1));
    // Unknown ground (not loaded) is not dry ground
    const ground = knownBlock(new Vec3(newX, pos.y - 1, newZ));
    if (!ground || ground.name === "water" || ground.name === "lava") continue;
    const result = await goTo(new pf.goals.GoalXZ(newX, newZ));
    if (!result.ok) {
      console.log(`Failed to move away: ${describeFailure(result)}`);
      return false;
    }
    console.log(`Moved away to ${bot.entity.position}.`);
    await __actionsDelay(500);
    return true;
  }
  console.log("Failed to move away: no known dry ground nearby.");
  return false;
}

export function getBotPosition(): { x: number, y: number, z: number } {
  const position = bot.entity.position;
  return {
    x: Math.floor(position.x), 
    y: Math.floor(position.y),
    z: Math.floor(position.z)
  };
}
