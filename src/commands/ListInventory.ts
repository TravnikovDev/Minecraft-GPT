// Path: src/actions/ListInventory.ts

import { z } from "zod";
import { listInventory } from "../actions/inventory";
import { syncInventory } from "../managers/persistenceManager";

export const description = `When user asks the bot to list its inventory, the bot will list all the items in its inventory.
Example: "List inventory", "What do you have?", "Show me your inventory".`;

// Define parameters for the ListInventory action
export const parameters = z.object({});

// Implement the ListInventory action
export async function execute() {
  const items = await listInventory();
  await syncInventory(items);
}
