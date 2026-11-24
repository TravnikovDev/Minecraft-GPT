// Path: src/actions/GiveItemToAPlayer.ts

import { z } from "zod";
import { giveToPlayer } from "../actions/inventory";
import { getNearbyPlayerNames } from "../actions/world";
import { bot } from "../core/body";
import { takeOffArmor, wornArmor } from "../actions/armor";

export const description = `When user asks the bot to give an item to a player, the bot will give the item to the player.
When no amount is said ("give me dark oak", "give me your wood"), it gives all it has of that item.
Example: "Give a sword to Steve.", "Give 2 apples to Alex", "Give a pickaxe to me", "Give me 20 spruce_log",
"Give me the dark oak".`;

// Define parameters for the GiveItemToAPlayer action
export const parameters = z.object({
  player_name: z.string().describe("The name of the player to give items."),
  item_name: z.string().describe("The name of the item to give."),
  num: z
    .number()
    .nullable()
    .describe("How many to give. Null when the owner names no amount: then all of it. 1 only for \"a\"/\"an\"/\"one\"."),
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
