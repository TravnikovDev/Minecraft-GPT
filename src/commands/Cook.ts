// Path: src/commands/Cook.ts

import { z } from "zod";
import { bot } from "../core/body";
import { cookFood, rawFoodInInventory } from "../actions/cooking";

export const description = `Cooks raw food from the inventory (beef, porkchop, chicken, mutton, rabbit, cod, salmon,
potatoes, kelp) on a lit campfire nearby, or in a smoker or furnace (burning coal, charcoal, planks or logs).
Puts down a campfire or furnace it carries if there's none nearby.
Example: "Cook the meat", "Cook your food", "Bake the potatoes", "Cook 5 chicken", "Use the campfire to cook".`;

export const parameters = z.object({
  itemName: z.string().nullable().describe("Minecraft ID of the raw food to cook (beef, chicken, potato...); null for all."),
  count: z.number().nullable().describe("How many to cook (default all)."),
});

export async function execute(args: any): Promise<void> {
  const parsed = parameters.safeParse(args);
  const only = parsed.success ? parsed.data.itemName?.replace(/^raw_/, "") ?? null : null;
  const limit = (parsed.success ? parsed.data.count : null) ?? 64;

  if (rawFoodInInventory(only).length === 0) {
    bot.chat(only ? `I don't have any raw ${only.replace(/_/g, " ")}.` : "I don't have any raw food to cook.");
    return;
  }
  const cooked = await cookFood(only, limit);
  if (cooked === null) {
    bot.chat("There's no lit campfire or furnace nearby (or no fuel), so I can't cook.");
  } else {
    bot.chat(cooked > 0 ? `Cooked ${cooked} food.` : "I couldn't cook anything.");
  }
}
