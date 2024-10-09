// Path: src/actions/GatherWood.ts

import { bot } from "../index";
import { goals } from "mineflayer-pathfinder";
import { z } from "zod";

// Define parameters for the GatherWood action
export const parameters = z.object({
  maxDistance: z
    .number()
    .describe("The maximum distance to search for wood blocks."),
});

// Implement the GatherWood action
export async function execute(args: any): Promise<void> {
  console.log(`Executing GatherWood with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error("Invalid parameters for GatherWood action.");
    return;
  }

  const { maxDistance } = parsed.data;

  try {
    console.log("Heading out to gather wood.");
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
        )
      );
      bot.once("goal_reached", async () => {
        try {
          await bot.dig(woodBlock);
          console.log("Wood gathered successfully!");
        } catch (digError) {
          console.error("Failed to dig the wood block:", digError);
        }
      });
    } else {
      console.log("No wood blocks found nearby.");
    }
  } catch (error) {
    console.error("Error executing GatherWood action:", error);
  }
}
