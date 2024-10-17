// Path: src/actions/GoToPlayer.ts

import { z } from "zod";
import { bot } from "../index";
import { goToPosition } from "../actions/movement";
import { getNearbyPlayerNames } from "../actions/world";

export const description = `When user asks the bot to go to a player, the bot will navigate to the player's location. 
   Example: "Go to player Steve", "Head towards Alex", "Move to player Notch", "Come to papa", "Come here".
   If no parameters are provided, the bot will move to username from begging of the message at 3 blocks close.`;

// Define parameters for the GoToPlayer action
export const parameters = z.object({
  player_name: z
    .string()
    .optional()
    .describe("The name of the player to go to."),
  closeness: z.number().optional().describe("How close to get to the player."),
});

// Implement the GoToPlayer action
export async function execute(args: any = {}) {
  // Validate arguments
  const parsed = parameters.parse(args);

  let { player_name, closeness } = parsed || {};
  // Default value for closeness
  closeness = closeness || 3;
  let targetPlayer;
  if (player_name) {
    targetPlayer = bot.players[player_name]?.entity;
  } else {
    const players = getNearbyPlayerNames(bot, 500);
    targetPlayer = bot.players[players[0]].entity;
  }

  if (targetPlayer) {
    bot.chat(`Heading towards ${targetPlayer.name}.`);
    await goToPosition(
      targetPlayer.position.x,
      targetPlayer.position.y,
      targetPlayer.position.z,
      closeness
    );
    await bot.lookAt(targetPlayer.position.offset(0, 1.6, 0));
  } else {
    bot.chat(`Could not find player to follow.`);
  }
}
