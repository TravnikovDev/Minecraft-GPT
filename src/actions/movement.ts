// src/actions/movement.ts

import pf from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import * as world from "./world.js";
import { bot } from "../index.js";
import { __actionsDelay, getRandomInt } from "../utils/utility.js";

export async function goToPosition(
  x: number,
  y: number,
  z: number,
  minDistance = 2
): Promise<boolean> {
  // bot.pathfinder.setMovements(new pf.Movements(bot));
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
        await bot.pathfinder.goto(
          new pf.goals.GoalNear(base.x, base.y, base.z, minDistance)
        );
        __actionsDelay(1000);
        await bot.pathfinder.goto(new pf.goals.GoalNear(x, y, z, minDistance));
      }
    } else {
      await bot.pathfinder.goto(new pf.goals.GoalNear(x, y, z, minDistance));
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

  const move = new pf.Movements(bot);
  bot.pathfinder.setMovements(move);
  await bot.pathfinder.goto(new pf.goals.GoalFollow(playerEntity, distance));

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

  const move = new pf.Movements(bot);
  bot.pathfinder.setMovements(move);
  bot.pathfinder.setGoal(new pf.goals.GoalFollow(playerEntity, distance), true);
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

    await bot.pathfinder.goto(farGoal);
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

  bot.pathfinder.setGoal(
    new pf.goals.GoalNear(doorPos.x, doorPos.y, doorPos.z, 1)
  );
  await __actionsDelay(1000);
  while (bot.pathfinder.isMoving()) {
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
