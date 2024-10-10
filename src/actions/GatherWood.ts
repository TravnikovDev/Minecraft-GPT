// Path: src/actions/GatherWood.ts

import { bot } from "../index";
import { z } from "zod";
import * as world from "../utils/world";
import { breakBlockAt, pickupNearbyItems } from "../utils/worldInteraction";
import { goToPosition } from "../utils/movement";
import { __actionsDelay } from "../utils/utility";

// Define parameters for the GatherWood action
export const parameters = z.object({
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

  let { num } = parsed.data;
  // Default values for maxDistance and num
  let maxDistance = 64;
  num = num || 64;

  try {
    console.log("Heading out to gather wood.");

    const gatherWood = async () => {
      const logsCount = await bot.inventory
        .items()
        .filter((item) => item.name.includes("log"))
        .reduce((acc, item) => acc + item.count, 0);

      if (logsCount >= (num || 10)) {
        bot.chat(`Wood gathering complete! I have ${logsCount} logs.`);
        return;
      }

      const woodBlock = await bot.findBlock({
        matching: (block) => block.name.includes("log"),
        maxDistance,
      });

      if (woodBlock) {
        const destination = await goToPosition(
          woodBlock.position.x,
          woodBlock.position.y,
          woodBlock.position.z
        );

        if (destination) {
          try {
            await bot.pathfinder.stop();

            const nearbyWoodBlocks = world.getNearestBlocks(
              bot,
              woodBlock.name,
              7
            );
            console.log(`Found ${nearbyWoodBlocks.length} wood blocks nearby.`);

            for (const block of nearbyWoodBlocks) {
              console.log(`Digging the wood block at ${block.position}.`);

              await breakBlockAt(
                block.position.x,
                block.position.y,
                block.position.z
              );
              await pickupNearbyItems(bot);
              await __actionsDelay(); // Add delay to simulate gathering
            }
            gatherWood(); // Repeat the process
          } catch (digError) {
            console.error("Failed to dig the wood block:", digError);
            gatherWood();
          }
        }
      } else {
        bot.chat("No wood blocks found nearby.");
      }
    };

    gatherWood();
  } catch (error) {
    console.error("Error executing GatherWood action:", error);
  }
}
