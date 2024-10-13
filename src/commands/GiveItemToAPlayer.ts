// Path: src/actions/GiveItemToAPlayer.ts

import { z } from "zod";
import { BotCommands } from "./types";
import { giveToPlayer } from "../actions/inventory";

export const description = `When user asks the bot to give an item to a player, the bot will give the item to the player.
Example: "Give a sword to Steve.", "Give 2 apples to Alex", "Give a pickaxe to me".`;

// Define parameters for the GiveItemToAPlayer action
export const parameters = z.object({
  player_name: z.string().describe("The name of the player to give items."),
  item_name: z.string().describe("The name of the item to give to the player."),
  num: z
    .number()
    .optional()
    .describe("The number of items to give to the player."),
});

// Register the action with zodFunction for validation
export const GiveItemToAPlayerFunction = {
  name: BotCommands.GiveItemToAPlayer,
  parameters: parameters,
};

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
  num = num || 1;

  await giveToPlayer(player_name, item_name, num);
}
