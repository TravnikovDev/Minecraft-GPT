// Path: src/actions/CheckForItem.ts

import { z } from "zod";
import { BotCommands } from "./types";
import { checkForItem } from "../actions/inventory";

export const description = `When user asks the bot`;

// Define parameters for the CheckForItem action
export const parameters = z.object({
  item_name: z
    .string()
    .describe("The name of the item to check into bot inventory."),
});

// Register the action with zodFunction for validation
export const CheckForItemFunction = {
  name: BotCommands.CheckForItem,
  parameters: parameters,
};

// Implement the CheckForItem action
export async function execute(args: any) {
  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(
      `Missing parameters for CheckForItem: item_name is undefined.`
    );
    return;
  }

  const { item_name } = parsed.data;
  checkForItem(item_name);
}
