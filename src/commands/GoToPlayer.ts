// Path: src/actions/GoToPlayer.ts

import { z } from "zod";
import { bot } from "../index";
import { goToPosition } from "../actions/movement";

export const description = `When user asks the bot to go to a player, the bot will navigate to the player's location. 
   Example: "Go to player Steve", "Head towards Alex", "Move to player Notch", "Come to papa", "Come here".
   If no parameters are provided, the bot will move to username from begging of the message at 3 blocks close.`;

// Define parameters for the GoToPlayer action
export const parameters = z.object({
  player_name: z.string().describe("The name of the player to go to."),
  closeness: z.number().optional().describe("How close to get to the player."),
});

// Implement the GoToPlayer action
export async function execute(args: any) {
  console.log(`Executing GoToPlayer with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(
      `Missing parameters for GoToPlayer: player_name or closeness is undefined.`
    );
    return;
  }

  let { player_name, closeness } = parsed.data;
  // Default value for closeness
  closeness = closeness || 3;
  const targetPlayer = bot.players[player_name]?.entity;

  if (targetPlayer) {
    goToPosition(
      targetPlayer.position.x,
      targetPlayer.position.y,
      targetPlayer.position.z,
      closeness
    );
    bot.chat(
      `Heading towards ${player_name}, getting ${closeness} blocks close.`
    );
  } else {
    bot.chat(`Could not find player ${player_name}.`);
  }
}
