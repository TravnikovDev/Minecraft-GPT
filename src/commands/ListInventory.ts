// Path: src/actions/ListInventory.ts

import { z } from "zod";
import { listInventory } from "../actions/inventory";

export const description = `When user asks the bot to list its inventory, the bot will list all the items in its inventory.
Example: "List inventory", "What do you have?", "Show me your inventory".`;

// Define parameters for the ListInventory action
export const parameters = z.object({});

// Implement the ListInventory action
export async function execute() {
  listInventory();
}
