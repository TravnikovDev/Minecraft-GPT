// Path: src/actions/ListInventory.ts

import { z } from "zod";
import { BotCommands } from "./types";
import { listInventory } from "../actions/inventory";

export const description = `When user asks the bot to list its inventory, the bot will list all the items in its inventory.
Example: "List inventory", "What do you have?", "Show me your inventory".`;

// Define parameters for the ListInventory action
export const parameters = z.object({});

// Register the action with zodFunction for validation
export const ListInventoryFunction = {
  name: BotCommands.ListInventory,
  parameters: parameters,
};

// Implement the ListInventory action
export async function execute(args: any) {
  listInventory();
}
