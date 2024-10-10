// Path: src/actions/GatherWood.ts

import { bot } from "../index";
import { goals } from "mineflayer-pathfinder";
import { z } from "zod";
import * as world from "../utils/world";
import { pickupNearbyItems } from "../utils/worldInteraction";

// Define parameters for the GatherWood action
export const parameters = z.object({
  maxDistance: z
    .number()
    .describe("The maximum distance to search for wood blocks."),
  num: z.number().describe("The number of wood logs to gather."),
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

  const { maxDistance, num } = parsed.data;

  try {
    console.log("Heading out to gather wood.");

    const gatherWood = async () => {
      const logsCount = await bot.inventory
        .items()
        .filter((item) => item.name.includes("log"))
        .reduce((acc, item) => acc + item.count, 0);

      if (logsCount >= (num || 10)) {
        bot.chat("Wood gathering complete!");
        return;
      }

      const woodBlock = await bot.findBlock({
        matching: (block) => block.name.includes("log"),
        maxDistance,
      });

      if (woodBlock) {
        bot.pathfinder.setGoal(
          new goals.GoalNear(
            woodBlock.position.x,
            woodBlock.position.y,
            woodBlock.position.z,
            2
          )
        );

        bot.once("goal_reached", async () => {
          console.log("Reached the wood block.");

          try {
            await bot.pathfinder.stop();

            const nearbyWoodBlocks = world.getNearestBlocks(
              bot,
              woodBlock.name,
              7
            );
            console.log(`Found ${nearbyWoodBlocks.length} wood blocks nearby.`);
            console.log(nearbyWoodBlocks);

            for (const block of nearbyWoodBlocks) {
              const axe = await bot.pathfinder.bestHarvestTool(block);
              console.log(`Using ${axe?.name} to dig the wood block.`);
              if (axe) {
                await bot.equip(axe, "hand");
              }
              console.log(`Digging the wood block at ${block.position}.`);
              await bot.dig(block);
              await pickupNearbyItems(bot);
              await new Promise((resolve) => setTimeout(resolve, 2500)); // Add delay to simulate gathering
            }
            gatherWood(); // Repeat the process
          } catch (digError) {
            console.error("Failed to dig the wood block:", digError);
            gatherWood();
          }
        });
      } else {
        bot.chat("No wood blocks found nearby.");
      }
    };

    gatherWood();
  } catch (error) {
    console.error("Error executing GatherWood action:", error);
  }
}
function Vec3(arg0: {
  woodBlock: import("prismarine-block").Block;
  "": any;
}): import("vec3").Vec3 {
  throw new Error("Function not implemented.");
}
