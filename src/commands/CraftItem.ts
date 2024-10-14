// Path: src/actions/CraftItem.ts

import { z } from "zod";
import { craftRecipe } from "../actions/crafting";
import { BotCommands } from "./types";

export const description = `When player is asking the bot to craft an item, the bot will craft the item. 
Example: "Craft a diamond sword", "Craft 5 wooden planks", "Craft 10 torches", etc.`;

// Define parameters for CraftItem action
export const parameters = z.object({
  itemName: z.string().describe("The name of the item to craft."),
  itemCount: z.number().optional().describe("The number of items to craft."),
});

// Register the action with zodFunction for validation
export const CollectBlockFunction = {
  name: BotCommands.CraftItem,
  parameters: parameters,
  description,
};

// Implement the CraftItem action
export async function execute(args: any) {
  console.log(`Executing CraftItem with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for CraftItem:`, parsed.error);
    return;
  }

  let { itemName, itemCount } = parsed.data;
  // Default values for toolCount
  itemCount = itemCount || 1;

  await craftRecipe(itemName, itemCount);
}
