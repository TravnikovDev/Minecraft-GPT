// Path: src/actions/ListInventory.ts

import { z } from "zod";
import { listInventory } from "../actions/inventory";
import { reply } from "../core/narrator";
import { wornArmor } from "../actions/armor";

export const description = `When user asks the bot to list its inventory, the bot will list all the items in its inventory.
Example: "List inventory", "What do you have?", "Show me your inventory".`;

// Define parameters for the ListInventory action
export const parameters = z.object({});

// Implement the ListInventory action
export async function execute() {
  await listInventory();
  const worn = wornArmor();
  if (worn.length > 0) reply(`Wearing: ${worn.map((n) => n.replace(/_/g, " ")).join(", ")}.`);
}
