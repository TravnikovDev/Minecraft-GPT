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
  if (x == null || y == null || z == null) {
    console.log(`Missing coordinates, given x:${x} y:${y} z:${z}`);
    return false;
  }
  bot.pathfinder.setMovements(new pf.Movements(bot));
  await bot.pathfinder.goto(new pf.goals.GoalNear(x, y, z, minDistance));
  console.log(`You have reached at ${x}, ${y}, ${z}.`);
  return true;
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
  const block = world.getNearestBlock(bot, blockType, range);
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

  // const move = new pf.Movements(bot);
  // bot.pathfinder.setMovements(move);
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

  // const move = new pf.Movements(bot);
  // bot.pathfinder.setMovements(move);
  bot.pathfinder.setGoal(new pf.goals.GoalFollow(playerEntity, distance), true);
  console.log(`You are now actively following player ${username}.`);

  return true;
}

export async function moveAway(distance: number): Promise<boolean> {
  try {
    let rand = getRandomInt(0, 1);
    let bigRand1 = getRandomInt(0, 100);
    let bigRand2 = getRandomInt(0, 100);

    const pos = bot.entity.position;
    const farGoal = new pf.goals.GoalXZ(
      pos.x + (distance * bigRand1) / 100,
      pos.z + ((distance * bigRand2) / 100) * (rand ? 1 : -1)
    );
    const invertedGoal = new pf.goals.GoalInvert(farGoal);

    await bot.pathfinder.goto(rand ? farGoal : invertedGoal);
    const newPos = bot.entity.position;
    console.log(`Moved away from nearest entity to ${newPos}.`);
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
      const doorBlock = world.getNearestBlock(bot, doorType, 16);
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
