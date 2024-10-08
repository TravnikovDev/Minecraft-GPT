// Path: src/managers/resourceManager.ts

import { bot } from "../index";
import { BotActions } from "./actionTypes";
import { z } from "zod";
import { goals } from "mineflayer-pathfinder";

// Define resource collection parameters
export const CollectBlocksParameters = z.object({
  type: z.string().describe("The block type to collect."),
  num: z.number().describe("The number of blocks to collect."),
});

// Collect Specific Blocks
export async function collectBlocks(
  type: string,
  num: number
): Promise<boolean> {
  try {
    let collected = 0;
    const listener = (block: any) => {
      if (block.name === type) {
        collected++;
        bot.chat(`Collected ${collected} of ${type} blocks.`);
        if (collected >= num) {
          bot.chat(`Collected all ${num} ${type} blocks.`);
          bot.removeListener("blockBreakProgressEnd", listener);
        }
      }
    };

    bot.on("blockBreakProgressEnd", listener);

    const block = bot.findBlock({
      matching: (b) => b.name === type,
      maxDistance: 32,
    });

    if (block) {
      bot.chat(`Starting to collect ${type} blocks.`);
      await bot.dig(block);
      return true;
    } else {
      bot.chat(`No ${type} blocks found nearby.`);
      bot.removeListener("blockBreakProgressEnd", listener);
      return false;
    }
  } catch (error) {
    console.error("Error while collecting blocks:", error);
    return false;
  }
}

// Collect Nearest Resource of Specific Type
export async function collectNearestResource(
  resourceType: string,
  range = 64
): Promise<boolean> {
  try {
    const resourceBlock = bot.findBlock({
      matching: (b) => b.name === resourceType,
      maxDistance: range,
    });

    if (resourceBlock) {
      const goal = new goals.GoalBlock(
        resourceBlock.position.x,
        resourceBlock.position.y,
        resourceBlock.position.z
      );
      bot.pathfinder.setGoal(goal);
      bot.chat(`Heading to nearest ${resourceType} to collect.`);
      bot.once("goal_reached", async () => {
        try {
          await bot.dig(resourceBlock);
          bot.chat(`Collected ${resourceType}.`);
        } catch (digError) {
          console.error("Error while digging resource block:", digError);
        }
      });
      return true;
    } else {
      bot.chat(`No ${resourceType} blocks found within ${range} blocks.`);
      return false;
    }
  } catch (error) {
    console.error("Error while collecting nearest resource:", error);
    return false;
  }
}

// Gather Wood (Default Idle Task)
export async function gatherWood(): Promise<boolean> {
  return await collectNearestResource("log");
}
