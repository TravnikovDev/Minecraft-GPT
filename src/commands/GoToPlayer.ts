// Path: src/actions/GoToPlayer.ts

import { z } from "zod";
import { bot } from "../index";
import { goToPosition, goToPlayer } from "../actions/movement";
import { getNearbyPlayerNames } from "../actions/world";
import { Movements } from "mineflayer-pathfinder";
import { unstuck } from "../actions/unstuck";

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
    if (!targetPlayer) {
      bot.chat(`Could not find player ${player_name}. They might be too far away or offline.`);
      return;
    }
  } else {
    const players = getNearbyPlayerNames(1000);
    if (players.length === 0) {
      bot.chat("No players found nearby.");
      return;
    }
    targetPlayer = bot.players[players[0]]?.entity;
    if (!targetPlayer) {
      bot.chat(`Could not locate the nearest player entity.`);
      return;
    }
  }

  bot.chat(`Heading towards ${targetPlayer.username || targetPlayer.name}.`);
  
  // Try to use the dedicated goToPlayer function first which uses GoalFollow
  try {
    const success = await goToPlayer(targetPlayer.username || targetPlayer.name, closeness);
    if (success) {
      await bot.lookAt(targetPlayer.position.offset(0, 1.6, 0));
      return;
    }
  } catch (error) {
    console.log(`Error using goToPlayer: ${error}. Trying alternative method...`);
  }

  // If GoalFollow fails, try with enhanced GoalNear approach
  try {
    // Create more permissive movement settings
    const movements = new Movements(bot);
    movements.canDig = true;
    movements.maxDropDown = 5;
    movements.allowSprinting = true;
    bot.pathfinder.setMovements(movements);
    
    const success = await goToPosition(
      targetPlayer.position.x,
      targetPlayer.position.y,
      targetPlayer.position.z,
      closeness
    );
    
    if (success) {
      await bot.lookAt(targetPlayer.position.offset(0, 1.6, 0));
    } else {
      // If still failed, try unstuck procedure
      bot.chat("Had trouble reaching the player. Trying to get unstuck...");
      await unstuck();
    }
  } catch (error) {
    bot.chat(`Failed to reach the player: ${error}`);
  }
}
