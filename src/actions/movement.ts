// src/actions/movement.ts

import pf from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import * as world from "./world.js";
import { bot } from "../core/body";
import { __actionsDelay, getRandomInt } from "../utils/utility.js";
import { isCommandCancelled } from "../core/commandContext";
import { isAnyReflexActive, waitForReflexes } from "../core/reflexes";
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
 */
export async function travelTo(
  getTarget: () => { x: number; y: number | null; z: number } | null,
  options: { range?: number; onProgress?: (percent: number) => void } = {}
): Promise<boolean> {
  const range = options.range ?? 2;
  const first = getTarget();
  if (!first) return false;
  const total = Math.max(1, distXZ(bot.entity.position, first));
  const reported = new Set<number>();
  const savedThink = pathing.thinkTimeout;
  pathing.thinkTimeout = 10000; // a leg of rough terrain can need more than the 5 s default
  let failures = 0;
  let crossings = 0;

  // A long trip: take a boat along for any water on the way (much faster
  // than swimming, and no drowning)
  if (total >= BOAT_TRIP_BLOCKS && !hasBoat()) {
    console.log("Long trip: making a boat first.");
    if (!(await ensureBoat())) console.log("Long trip: no boat (no wood); going without.");
    if (isCommandCancelled()) return false;
  }

  try {
    while (failures < MAX_LEG_FAILURES) {
      if (isCommandCancelled()) return false;
      await waitForReflexes(isCommandCancelled); // creepers, mobs and running out of air come first
      const target = getTarget();
      if (!target) return false;
      const pos = bot.entity.position;
      const remaining = distXZ(pos, target);

      const percent = Math.floor(((total - remaining) / total) * 5) * 20;
      if (percent >= 20 && percent < 100 && !reported.has(percent)) {
        reported.add(percent);
        options.onProgress?.(percent);
      }

      // Close enough horizontally: arrived. The owner's y is often approximate
      // (e.g. 100 for ground at 70), so never insist on reaching an exact height.
      if (remaining <= range + 1) return true;

      // Water in the way: row across instead of swimming
      if (remaining > 24 && crossings < MAX_BOAT_CROSSINGS && hasBoat() && waterAhead(target)) {
        crossings++;
        if (await crossWaterByBoat(target)) {
          failures = 0;
          continue;
        }
        if (isCommandCancelled()) return false;
      }

      // Last stretch: walk to the spot on the ground. Use the height only when
      // it is close to the bot's own level; otherwise aim for x/z alone.
      if (remaining <= LEG_BLOCKS) {
        try {
          const useHeight = target.y !== null && Math.abs(target.y - pos.y) <= 6;
          const goal = useHeight
            ? new pf.goals.GoalNear(target.x, target.y!, target.z, range)
            : new pf.goals.GoalNearXZ(target.x, target.z, range);
          await pathing.goto(goal);
          return true;
        } catch (error) {
          if (isAnyReflexActive()) continue; // interrupted by a reflex, not a real failure
          failures++;
          console.log(`travelTo final leg failed (${(error as Error).message}), retry ${failures}`);
          if (isCommandCancelled()) return false;
          continue;
        }
      }

      // A leg toward the target; after a failure try sidesteps left/right
      const side = failures === 0 ? 0 : (failures % 2 ? 1 : -1) * 0.5 * Math.ceil(failures / 2);
      const angle = Math.atan2(target.z - pos.z, target.x - pos.x) + side;
      const step = failures > 0 ? LEG_BLOCKS / 2 : LEG_BLOCKS;
      const legX = Math.round(pos.x + Math.cos(angle) * step);
      const legZ = Math.round(pos.z + Math.sin(angle) * step);
      try {
        await pathing.goto(new pf.goals.GoalNearXZ(legX, legZ, 3));
        failures = 0;
      } catch (error) {
        if (isAnyReflexActive()) continue; // interrupted by a reflex, not a real failure
        failures++;
        console.log(`travelTo leg failed (${(error as Error).message}), retry ${failures}`);
        if (isCommandCancelled()) return false;
      }
    }
    return false;
  } finally {
    pathing.thinkTimeout = savedThink;
  }
}

export async function goToPosition(
  x: number,
  y: number,
  z: number,
  minDistance = 2
): Promise<boolean> {
  // pathing.setMovements(new pf.Movements(bot));
  let base: Vec3 | undefined;

  try {
    if (base && typeof base === 'object' && 'x' in base && 'y' in base && 'z' in base) {
      const baseBlock = bot.blockAt(new Vec3(base.x, base.y, base.z));
      const startBlock = bot.blockAt(new Vec3(x, y, z));
      const baseArea = 20;
      if (
        baseBlock &&
        startBlock &&
        baseBlock.position.distanceTo(startBlock.position) < baseArea
      ) {
        // If the targe position is within the base area, go to the base first
        // fix to prevent bot breaking walls
        await pathing.goto(
          new pf.goals.GoalNear(base.x, base.y, base.z, minDistance)
        );
        __actionsDelay(1000);
        await pathing.goto(new pf.goals.GoalNear(x, y, z, minDistance));
      }
    } else {
      await pathing.goto(new pf.goals.GoalNear(x, y, z, minDistance));
      console.log(`You have reached at ${x}, ${y}, ${z}.`);
    }
    return true;
  } catch (err) {
    console.log(`Failed to go to position: ${(err as Error).message}`);
    return false;
  }
}

export async function goToNearestBlock(
  blockType: string,
  minDistance = 2,
  range = 64
): Promise<boolean> {
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
  await goToPosition(
    block.position.x,
    block.position.y,
    block.position.z,
    minDistance
  );
  return true;
}

export async function goToPlayer(
  username: string,
  distance = 3
): Promise<boolean> {
  const playerEntity = bot.players[username]?.entity;
  if (!playerEntity) {
    console.log(`Could not find ${username}.`);
    return false;
  }

  await pathing.goto(new pf.goals.GoalFollow(playerEntity, distance));

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

export async function moveAway(distance: number): Promise<boolean> {
  try {
    const pos = bot.entity.position;
    let newX: number = 0;
    let newZ: number = 0;
    let suitableGoal = false;

    while (!suitableGoal) {
      let rand1 = getRandomInt(0, 1);
      let rand2 = getRandomInt(0, 1);
      let bigRand1 = getRandomInt(0, 100);
      let bigRand2 = getRandomInt(0, 100);

      newX = Math.floor(
        pos.x + ((distance * bigRand1) / 100) * (rand1 ? 1 : -1)
      );
      newZ = Math.floor(
        pos.z + ((distance * bigRand2) / 100) * (rand2 ? 1 : -1)
      );

      const block = bot.blockAt(new Vec3(newX, pos.y - 1, newZ));

      if (block?.name !== "water" && block?.name !== "lava") {
        suitableGoal = true;
      }
    }

    const farGoal = new pf.goals.GoalXZ(newX, newZ);

    await pathing.goto(farGoal);
    const newPos = bot.entity.position;
    console.log(`Moved away from nearest entity to ${newPos}.`);
    await __actionsDelay(500);
    return true;
  } catch (err) {
    console.log(`Failed to move away: ${(err as Error).message}`);
    return false;
  }
}

export async function useDoor(doorPos: Vec3 | null = null): Promise<boolean> {
  if (!doorPos) {
    for (const doorType of [
      "oak_door",
      "spruce_door",
      "birch_door",
      "jungle_door",
      "acacia_door",
      "dark_oak_door",
      "mangrove_door",
      "cherry_door",
      "bamboo_door",
      "crimson_door",
      "warped_door",
    ]) {
      const doorBlock = world.getNearestBlock(doorType, 16);
      if (doorBlock) {
        doorPos = doorBlock.position;
        break;
      }
    }
  }
  if (!doorPos) {
    console.log(`Could not find a door to use.`);
    return false;
  }

  pathing.setGoal(
    new pf.goals.GoalNear(doorPos.x, doorPos.y, doorPos.z, 1)
  );
  await __actionsDelay(1000);
  while (pathing.isMoving()) {
    await __actionsDelay(100);
  }

  const doorBlock = bot.blockAt(doorPos);
  if (!doorBlock) {
    console.log(`No block found at the door position.`);
    return false;
  }
  await bot.lookAt(doorPos);
  if (!doorBlock.getProperties()["open"]) {
    await bot.activateBlock(doorBlock);
  }

  bot.setControlState("forward", true);
  await __actionsDelay(600);
  bot.setControlState("forward", false);
  await bot.activateBlock(doorBlock);

  console.log(`Used door at ${doorPos}.`);
  return true;
}

export async function goToBed(): Promise<boolean> {
  const beds = bot.findBlocks({
    matching: (block) => block.name.includes("bed"),
    maxDistance: 32,
    count: 1,
  });
  if (beds.length === 0) {
    console.log(`Could not find a bed to sleep in.`);
    return false;
  }
  const loc = beds[0];
  await goToPosition(loc.x, loc.y, loc.z);
  const bed = bot.blockAt(loc);
  if (!bed) {
    console.log(`No bed found at the specified location.`);
    return false;
  }
  try {
    await bot.sleep(bed);
    console.log(`You are in bed.`);
    while (bot.isSleeping) {
      await __actionsDelay(500);
    }
    console.log(`You have woken up.`);
    return true;
  } catch (err) {
    console.log(`Failed to sleep: ${(err as Error).message}`);
    return false;
  }
}

export function getBotPosition(): { x: number, y: number, z: number } {
  const position = bot.entity.position;
  return {
    x: Math.floor(position.x), 
    y: Math.floor(position.y),
    z: Math.floor(position.z)
  };
}
