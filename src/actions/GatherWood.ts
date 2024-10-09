// Path: src/actions/GatherWood.ts

import { bot } from "../index";
import { BotActions } from "./types";
import { goals } from "mineflayer-pathfinder";
import { z } from "zod";
import { Vec3 } from "vec3";

// Define parameters for the GatherWood action
export const parameters = z.object({
  maxDistance: z
    .number()
    .describe("The maximum distance to search for wood blocks."),
});

let isGatheringWood = false; // Lock mechanism to prevent multiple concurrent GatherWood actions

// Implement the GatherWood action
export async function execute(args: any) {
  console.log(`Executing GatherWood with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error("Invalid parameters for GatherWood action.");
    return;
  }

  if (isGatheringWood) {
    console.log("Already gathering wood, skipping this action.");
    return;
  }

  isGatheringWood = true;

  const { maxDistance } = parsed.data;

  try {
    bot.chat("Heading out to gather wood.");
    let woodBlock = bot.findBlock({
      matching: (block) => block.name.includes("log"),
      maxDistance,
    });

    if (woodBlock) {
      await gatherStackOfLogs(woodBlock.position);
    } else {
      bot.chat("No wood blocks found nearby.");
    }
  } catch (error) {
    console.error("Error executing GatherWood action:", error);
  } finally {
    isGatheringWood = false;
  }
}

// Helper function to gather a stack of logs
async function gatherStackOfLogs(startPosition: Vec3) {
  let currentPosition = startPosition;
  const startTime = Date.now();
  const timeout = 30000; // 30 seconds timeout to avoid getting stuck

  while (true) {
    if (Date.now() - startTime > timeout) {
      bot.chat("I got stuck trying to gather wood.");
      break;
    }

    const block = bot.blockAt(currentPosition);
    if (block && block.name.includes("log")) {
      try {
        bot.pathfinder.setGoal(
          new goals.GoalBlock(
            currentPosition.x,
            currentPosition.y,
            currentPosition.z
          )
        );
        await new Promise((resolve) => bot.once("goal_reached", resolve));
        await bot.dig(block);
        bot.chat("Wood block gathered successfully!");
        currentPosition = currentPosition.offset(0, 1, 0); // Move up to the next log in the stack
      } catch (digError) {
        console.error("Failed to dig the wood block:", digError);
        bot.chat("Failed to gather the wood block.");
        break;
      }
    } else {
      bot.chat("No more wood blocks in the stack.");
      break;
    }
  }
}
