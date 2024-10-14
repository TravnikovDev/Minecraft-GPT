// Path: src/actions/DiscardItem.ts

import { z } from "zod";
import { discard } from "../actions/inventory";

export const description = `When user asks the bot to discard an item from its inventory, the bot will discard the item.
Example: "Discard the sword.", "Drop the pickaxe", "Get rid of the food.".`;

// Define parameters for the DiscardItem action
export const parameters = z.object({
  item_name: z.string().describe("The name of the item to discard"),
  num: z.number().optional().describe("The number of items to discard."),
});

// Implement the DiscardItem action
export async function execute(args: any) {
  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(
      `Missing parameters for DiscardItem: item_name is undefined.`
    );
    return;
  }

  let { item_name, num } = parsed.data;
  num = num || 1;

  await discard(item_name, num);
}
