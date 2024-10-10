// Path: src/actions/GatherWood.ts

import { bot } from "../index";
import { BotActions } from "./types";
import { goals } from "mineflayer-pathfinder";
import { z } from "zod";
import * as world from "../utils/world";

// Define parameters for the GatherWood action
export const parameters = z.object({
  maxDistance: z
    .number()
    .describe("The maximum distance to search for wood blocks."),
});

// Implement the GatherWood action
export async function execute(args: any) {
  console.log(`Executing GatherWood with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error("Invalid parameters for GatherWood action.");
    return;
  }

  const { maxDistance } = parsed.data;

  try {
    bot.chat("Heading out to gather wood.");
    const woodBlock = bot.findBlock({
      matching: (block) => block.name.includes("log"),
      maxDistance,
    });

    if (woodBlock) {
      bot.pathfinder.setGoal(
        new goals.GoalBlock(
          woodBlock.position.x,
          woodBlock.position.y,
          woodBlock.position.z
        ),
        true
      );

      bot.once("goal_reached", async () => {
        try {
          const nearbyWoodBlocks = world.getNearestBlocks(bot, ["log"], 7);
          console.log("Nearby wood blocks:", nearbyWoodBlocks);
          for (const block of nearbyWoodBlocks) {
            await bot.dig(block);
            await new Promise((resolve) => setTimeout(resolve, 2500)); // Add delay to simulate gathering
          }
          bot.chat("Wood gathered successfully!");
        } catch (digError) {
          console.error("Failed to dig the wood block:", digError);
          bot.chat("Failed to gather the wood block.");
        }
      });
    } else {
      bot.chat("No wood blocks found nearby.");
    }
  } catch (error) {
    console.error("Error executing GatherWood action:", error);
  }
}
