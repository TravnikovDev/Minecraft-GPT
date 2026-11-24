// Path: src/actions/GiveItemToAPlayer.ts

import { z } from "zod";
import { catalog } from "../core/catalog";
import { giveToPlayer } from "../actions/inventory";
import { getNearbyPlayerNames } from "../actions/world";
import { bot } from "../core/body";
import { takeOffArmor, wornArmor } from "../actions/armor";

export const description = `When user asks the bot to give an item to a player, the bot will give the item to the player.
When no amount is said ("give me dark oak", "give me your wood"), it gives all it has of that item.
Example: "Give a sword to Steve.", "Give 2 apples to Alex", "Give a pickaxe to me", "Give me 20 spruce_log",
"Give me the dark oak", "Give me half of your coal" (fraction 0.5).`;

// Define parameters for the GiveItemToAPlayer action
export const parameters = z.object({
  player_name: z.string().describe("The name of the player to give items."),
  item_name: z.string().describe("The name of the item to give."),
  num: z
    .number()
    .nullable()
    .describe("How many to give. Null when the owner names no amount: then all of it. 1 only for \"a\"/\"an\"/\"one\"."),
  fraction: z
    .number()
    .nullable()
    .describe("A share of what the bot carries instead of a count: 0.5 for \"half\" or \"1/2\", 0.25 for \"a quarter\". Null otherwise."),
});

// Implement the GiveItemToAPlayer action
export async function execute(args: any) {
  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(
      `Missing parameters for GiveItemToAPlayer: item_name is undefined.`
    );
    return;
  }

  let { player_name, item_name, num } = parsed.data;
  const { fraction } = parsed.data;
  item_name = item_name.trim().toLowerCase().replace(/\s+/g, "_");

  // A loose name ("pressure plate", "planks"): match what the bot really carries or wears
  const have = [...new Set([...bot.inventory.items().map((i) => i.name), ...wornArmor()])];
  if (!have.includes(item_name)) {
    const matches = catalog().resolveLoose(item_name, have);
    if (matches.length === 1) item_name = matches[0]!;
    else if (matches.length > 1) {
      const names = matches.map((n) => n.replace(/_/g, " "));
      bot.chat(`I have ${names.slice(0, -1).join(", ")} and ${names.at(-1)}. Which one?`);
      return;
    }
  }
  const pretty = item_name.replace(/_/g, " ");
  let carried = bot.inventory.items().filter((i) => i.name === item_name).reduce((n, i) => n + i.count, 0);

  // Worn armor isn't in the bag: take it off first so it can be handed over
  if (carried === 0 && wornArmor().includes(item_name)) {
    if (await takeOffArmor(item_name)) carried = 1;
  }
  if (carried === 0) {
    bot.chat(`I don't have any ${pretty}.`);
    return;
  }
  // A share ("half of your coal") is counted from what it carries now
  if (fraction && fraction > 0 && fraction < 1) num = Math.max(1, Math.floor(carried * fraction));
  // No amount said: give all of it
  if (!num) num = carried;
  num = Math.min(num, carried);

  let theName;
  if (player_name) {
    theName = player_name;
  } else {
    const players = getNearbyPlayerNames(1000);
    theName = players[0];
  }

  const result = await giveToPlayer(item_name, theName, num);
  if (result) {
    bot.chat(`Gave ${num} ${item_name} to ${theName}`);
  } else {
    bot.chat(`Failed to give ${num} ${item_name} to ${theName}`);
  }
}
