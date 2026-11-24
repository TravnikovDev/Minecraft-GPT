// Path: src/actions/FindAndRememberNearChest.ts

import { z } from "zod";
import { catalog } from "../core/catalog";
import { bot } from "../core/body";
import { Vec3 } from "vec3";

export const description = `When user asks the bot to find and remember nearby chests, the bot will search for chests
within a specified radius and categorize their contents. The bot will remember the locations of the chests and the
categories of their contents for later use. Example: "Find and remember chests within 10 blocks.", "Remember those chests".
If no parameters are provided, the bot will search for chests within a radius of 10 blocks.`;

// Define parameters for FindAndRememberNearChest action
export const parameters = z.object({
  radius: z.number().nullable().describe("Radius to search for chests"),
});

// Chest memory object to store locations and categories
const chestMemory: { [category: string]: Vec3[] } = {};

// Function to categorize chest contents
function categorizeChest(contents: any[]): string {
  if (
    contents.some(
      (item) => catalog().toolKind(item.name) !== null
    )
  ) {
    return "Tools";
  } else if (
    contents.some(
      (item) => catalog().isLog(item.name) || catalog().isOre(item.name) || catalog().oresFor(item.name).length > 0
    )
  ) {
    return "RawResources";
  } else if (
    contents.some(
      (item) => catalog().isPlanks(item.name) || /_ingot$/.test(item.name)
    )
  ) {
    return "RefinedMaterials";
  } else if (
    contents.some(
      (item) => catalog().isFood(item.name)
    )
  ) {
    return "Food";
  } else {
    return "Miscellaneous";
  }
}

// Implement the FindAndRememberNearChest action
export async function execute(args: any) {
  console.log(`Executing FindAndRememberNearChest with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(
      `Invalid parameters for FindAndRememberNearChest:`,
      parsed.error
    );
    return;
  }

  let { radius } = parsed.data;
  radius = radius || 10;

  // Search for chests within the specified radius
  const chestsFound = bot.findBlocks({
    matching: (block) => block.name === "chest",
    maxDistance: radius,
    count: 10,
  });

  // Process each chest found
  for (const pos of chestsFound) {
    const chestPosition = new Vec3(pos.x, pos.y, pos.z);
    const block = bot.blockAt(chestPosition);
    if (block) {
      const chest = await bot.openChest(block);
      const category = categorizeChest(chest.containerItems());
      if (!chestMemory[category]) {
        chestMemory[category] = [];
      }
      chestMemory[category].push(chestPosition);
      await chest.close();
      bot.chat(`Found a chest categorized as ${category} at ${chestPosition}.`);
    } else {
      console.error(`No block found at position ${chestPosition}`);
    }
  }

  console.log("Chest memory updated:", chestMemory);
  bot.chat("Chest scanning complete. Chest locations stored for later use.");
}
