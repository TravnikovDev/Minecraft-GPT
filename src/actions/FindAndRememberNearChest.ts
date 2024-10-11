// Path: src/actions/FindAndRememberNearChest.ts

import { z } from "zod";
import { BotActions } from "./types";
import { bot } from "../index";
import { Vec3 } from "vec3";

// Define parameters for FindAndRememberNearChest action
export const parameters = z.object({
  radius: z.number().describe("Radius to search for chests"),
});

// Chest memory object to store locations and categories
const chestMemory: { [category: string]: Vec3[] } = {};

// Function to categorize chest contents
function categorizeChest(contents: any[]): string {
  if (
    contents.some(
      (item) =>
        item.name.includes("pickaxe") ||
        item.name.includes("shovel") ||
        item.name.includes("sword")
    )
  ) {
    return "Tools";
  } else if (
    contents.some(
      (item) => item.name.includes("log") || item.name.includes("ore")
    )
  ) {
    return "RawResources";
  } else if (
    contents.some(
      (item) => item.name.includes("plank") || item.name.includes("ingot")
    )
  ) {
    return "RefinedMaterials";
  } else if (
    contents.some(
      (item) =>
        item.name.includes("food") ||
        item.name.includes("apple") ||
        item.name.includes("bread")
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

  const { radius } = parsed.data;
  const chestsFound: Vec3[] = [];

  // Search for chests within the specified radius
  const blocks = bot.findBlocks({
    matching: (block) => block.name === "chest",
    maxDistance: radius,
    count: 10,
  });

  // Process each chest found
  for (const pos of blocks) {
    const chestPosition = new Vec3(pos.x, pos.y, pos.z);
    const block = bot.blockAt(chestPosition);
    if (block) {
      const chest = await bot.openChest(block);
      const category = categorizeChest(chest.containerItems());
      if (!chestMemory[category]) {
        chestMemory[category] = [];
      }
      chestMemory[category].push(chestPosition);
      chest.close();
      bot.chat(`Found a chest categorized as ${category} at ${chestPosition}.`);
    } else {
      console.error(`No block found at position ${chestPosition}`);
    }

    const category = categorizeChest(chest.containerItems());
    if (!chestMemory[category]) {
      chestMemory[category] = [];
    }

    chestMemory[category].push(chestPosition);
    chest.close();
    bot.chat(`Found a chest categorized as ${category} at ${chestPosition}.`);
  }

  console.log("Chest memory updated:", chestMemory);
  bot.chat("Chest scanning complete. Chest locations stored for later use.");
}
