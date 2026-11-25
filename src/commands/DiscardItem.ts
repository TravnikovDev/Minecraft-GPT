// Path: src/actions/DiscardItem.ts

import { z } from "zod";
import { discard, itemMatcher } from "../actions/inventory";
import { bot } from "../core/body";
import { report } from "../core/narrator";

export const description = `When user asks the bot to discard an item from its inventory, the bot will discard the item.
Example: "Discard the sword.", "Drop the pickaxe", "Get rid of the food.".`;

// Define parameters for the DiscardItem action
export const parameters = z.object({
  item_name: z.string().describe("The name of the item to discard"),
  num: z.number().nullable().describe("The number of items to discard."),
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
  num = num || 64;

  // Say what really left the inventory, not what was asked for
  const matches = itemMatcher(item_name);
  const carriedNow = (): number => bot.inventory.items().filter((i) => matches(i.name)).reduce((n, i) => n + i.count, 0);
  const before = carriedNow();
  if (before === 0) {
    report(`I don't have any ${item_name.replace(/_/g, " ")}.`);
    return;
  }
  await discard(item_name, num);
  const thrown = before - carriedNow();
  report(thrown > 0 ? `Discarded ${thrown} ${item_name.replace(/_/g, " ")}.` : `I couldn't throw away the ${item_name.replace(/_/g, " ")}.`);
}
