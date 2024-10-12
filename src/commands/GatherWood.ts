// Path: src/actions/GatherWood.ts

import { bot } from "../index";
import { z } from "zod";
import * as world from "../utils/world";
import { breakBlockAt, pickupNearbyItems } from "../utils/worldInteraction";
import { goToPosition } from "../utils/movement";
import { __actionsDelay } from "../utils/utility";
import { addActionToQueue } from "../managers/persistenceManager";
import { BotCommands } from "./types";

export const description = `When user asks the bot to gather wood, the bot will search for wood blocks nearby and gather them.
The bot will continue gathering wood until the specified number of logs is reached. Example: "Gather wood", "Collect some logs".
If no parameters are provided, the bot will gather 32 logs at radius of 64 blocks.`;

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
  num = num || 32;

  try {
    console.log("Heading out to gather wood.");
    // Check if the bot has an axe
    const hasAxe = bot.inventory
      .items()
      .some((item) => item.name.includes("axe"));

    if (!hasAxe) {
      addActionToQueue({
        id: "craft wooden axe",
        action: BotCommands.CraftWoodenTools,
        priority: 9,
        args: {
          toolCount: {
            pickaxe: 0,
            axe: 1,
            sword: 0,
            shovel: 0,
          },
        },
      });
      // Wait for the crafting to complete (assuming some delay or event to check)
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Adjust the delay as needed
    }

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
