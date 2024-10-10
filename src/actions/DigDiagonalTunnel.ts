// Path: src/actions/DigDiagonalTunnel.ts

import { z } from "zod";
import { bot } from "../index";
import {
  breakBlockAt,
  pickupNearbyItems,
  placeBlock,
} from "../utils/worldInteraction";
import { craftRecipe } from "../utils/crafting";

// Define parameters for DigDiagonalTunnel action
export const parameters = z.object({
  minDepth: z.number().describe("Minimum depth of the tunnel"),
  maxDepth: z.number().describe("Maximum depth of the tunnel"),
  torchInterval: z.number().describe("Interval for torch placement"),
  tunnelSize: z
    .object({
      width: z.number(),
      height: z.number(),
    })
    .describe("Dimensions of the tunnel"),
});

// Implement the DigDiagonalTunnel action
export async function execute(args: any) {
  console.log(`Executing DigDiagonalTunnel with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for DigDiagonalTunnel:`, parsed.error);
    return;
  }

  let { minDepth, maxDepth, torchInterval, tunnelSize } = parsed.data;
  let startPosition = bot.entity.position.clone();

  // Default values for tunnel size
  minDepth = minDepth || 10;
  maxDepth = maxDepth || 75;
  torchInterval = torchInterval || 12;
  tunnelSize = tunnelSize || { width: 3, height: 4 };

  let reachedEnd = false;

  // Dig the tunnel
  for (let i = 1; i <= maxDepth; i++) {
    const basePosition = startPosition.offset(i, -i, i); // Diagonal downward

    // Check if there is air in the tunnel area
    for (let x = 0; x < tunnelSize.width; x++) {
      for (let y = 0; y < tunnelSize.height; y++) {
        const checkPosition = basePosition.offset(x, y, 0);
        const block = bot.blockAt(checkPosition);
        if (!block || block.name === "air") {
          bot.chat(
            `Encountered air at ${checkPosition.toString()}, stopping tunnel dig.`
          );
          reachedEnd = true;
          break;
        }
      }
      if (reachedEnd) break;
    }
    if (reachedEnd) break;

    // Dig the 3x4 area for the tunnel
    for (let x = 0; x < tunnelSize.width; x++) {
      for (let y = 0; y < tunnelSize.height; y++) {
        const digPosition = basePosition.offset(x, y, 0);
        breakBlockAt(digPosition.x, digPosition.y, digPosition.z);
      }
      await pickupNearbyItems(bot);
    }

    // Place torch every `torchInterval` blocks
    if (i % torchInterval === 0) {
      const torchPosition = basePosition.offset(1, 1, 0); // Offset for wall placement
      const torch = bot.inventory.items().find((item) => item.name === "torch");
      if (torch) {
        const torchBlock = bot.blockAt(torchPosition);
        if (torchBlock) {
          //   await bot.placeBlock(torchBlock, torch);
          await placeBlock(
            "wall_torch",
            torchPosition.x,
            torchPosition.y,
            torchPosition.z,
            "side"
          );
        }
        bot.chat(`Placed torch at ${torchPosition.toString()}`);
      } else {
        console.log("No torches found in inventory.");
        // TODO: Craft torches
      }
    }
  }

  // Place crafting table at the end of the tunnel
  if (!reachedEnd) {
    const endPosition = startPosition.offset(maxDepth, -maxDepth, maxDepth);
    const craftingTable = bot.inventory
      .items()
      .find((item) => item.name === "crafting_table");
    if (craftingTable) {
      const endBlock = bot.blockAt(endPosition);
      if (endBlock) {
        // await bot.placeBlock(endBlock, craftingTable);
        await placeBlock(
          "crafting_table",
          endPosition.x,
          endPosition.y,
          endPosition.z,
          "bottom"
        );
      } else {
        bot.chat(
          `Cannot place crafting table, no block found at ${endPosition.toString()}`
        );
      }
      bot.chat("Placed crafting table at the end of the tunnel.");
    }
  }

  const cobblestoneCount = await bot.inventory
    .items()
    .filter((item) => item.name.includes("cobblestone"))
    .reduce((acc, item) => acc + item.count, 0);

  const stairsNeeded = Math.floor(maxDepth * tunnelSize.width);
  const cobblestonesNeeded = Math.ceil(stairsNeeded / 0.66);

  // 6 cobblestones for 4 stairs
  if (cobblestoneCount >= cobblestonesNeeded) {
    craftRecipe("cobblestone_stairs", stairsNeeded);
    bot.chat(`Crafted ${stairsNeeded} cobblestone stairs.`);
  } else {
    bot.chat(
      `Not enough cobblestone! I have ${cobblestoneCount} and I need ${cobblestonesNeeded} block.`
    );
    // TODO: gatherCobblesotne(cobblestonesNeeded - cobblestoneCount)
  }

  // Place stairs along the tunnel path
  for (let i = 1; i <= maxDepth; i++) {
    const stairPosition = startPosition.offset(i, -i, i);
    const stairs = bot.inventory
      .items()
      .find((item) => item.name === "cobblestone_stairs");
    if (stairs) {
      const stairBlock = bot.blockAt(stairPosition);
      if (stairBlock) {
        // await bot.placeBlock(stairBlock, stairs);
        await placeBlock(
          "cobblestone_stairs",
          stairPosition.x,
          stairPosition.y,
          stairPosition.z,
          "bottom"
        );
        bot.chat(`Placed cobblestone stair at ${stairPosition.toString()}`);
      } else {
        bot.chat(
          `Cannot place stair, no block found at ${stairPosition.toString()}`
        );
      }
      bot.chat(`Placed cobblestone stair at ${stairPosition.toString()}`);
    }
  }

  bot.chat("Tunnel setup complete.");
}
