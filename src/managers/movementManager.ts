// Path: src/managers/movementManager.ts

import { bot } from "../index";
import { goals } from "mineflayer-pathfinder";
import { GoToPositionParameters } from "./toolSchemas";
import { z } from "zod";

// Move to Specific Position
export async function goToPosition(
  parameters: z.infer<typeof GoToPositionParameters>
): Promise<boolean> {
  try {
    const { x, y, z, minDistance } = parameters;
    const goal = new goals.GoalNear(x, y, z, minDistance || 1);
    bot.pathfinder.setGoal(goal);
    bot.chat(`Heading to position X: ${x}, Y: ${y}, Z: ${z}`);
    return true;
  } catch (error) {
    console.error("Error while moving to position:", error);
    return false;
  }
}

// Move to the Nearest Block of a Specific Type
export async function goToNearestBlock(
  blockType: string,
  range = 64
): Promise<boolean> {
  try {
    const block = bot.findBlock({
      matching: (b) => b.name === blockType,
      maxDistance: range,
    });
    if (block) {
      const goal = new goals.GoalBlock(
        block.position.x,
        block.position.y,
        block.position.z
      );
      bot.pathfinder.setGoal(goal);
      bot.chat(`Moving to the nearest ${blockType} block.`);
      return true;
    } else {
      bot.chat(`No ${blockType} blocks found within ${range} blocks.`);
      return false;
    }
  } catch (error) {
    console.error("Error while searching for block:", error);
    return false;
  }
}

// Follow a Player by Name
export async function followPlayer(
  playerName: string,
  followDistance = 3
): Promise<boolean> {
  try {
    const player = bot.players[playerName]?.entity;
    if (player) {
      const goal = new goals.GoalFollow(player, followDistance);
      bot.pathfinder.setGoal(goal);
      bot.chat(
        `Following player ${playerName} at a distance of ${followDistance} blocks.`
      );
      return true;
    } else {
      bot.chat(`Player ${playerName} not found.`);
      return false;
    }
  } catch (error) {
    console.error("Error while following player:", error);
    return false;
  }
}

// Move Away from Position (Self-Preservation)
export async function moveAway(distance: number): Promise<boolean> {
  try {
    const pos = bot.entity.position;
    const goal = new goals.GoalInvert(
      new goals.GoalNear(pos.x, pos.y, pos.z, distance)
    );
    bot.pathfinder.setGoal(goal);
    bot.chat(`Moving away from current position by ${distance} blocks.`);
    return true;
  } catch (error) {
    console.error("Error while moving away:", error);
    return false;
  }
}

// Stop Movement
export async function stopMovement(): Promise<void> {
  try {
    bot.pathfinder.setGoal(null);
    bot.chat("Stopping movement.");
  } catch (error) {
    console.error("Error while stopping movement:", error);
  }
}
