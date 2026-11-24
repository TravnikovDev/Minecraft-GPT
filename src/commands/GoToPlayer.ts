// Path: src/actions/GoToPlayer.ts

import { z } from "zod";
import { bot } from "../core/body";
import { goToPosition, goToPlayer, LONG_TRIP_BLOCKS, travelTo } from "../actions/movement";
import { isCommandCancelled } from "../core/commandContext";
import { lastKnownOwnerPosition, ridingWithOwner, tellOwner } from "../managers/ownerDialog";
import { getNearbyPlayerNames } from "../actions/world";
import { walkingRules } from "../core/movements";
import { unstuck } from "../actions/unstuck";
import { pathing } from "../core/plugins";

export const description = `When user asks the bot to go to a player, the bot will navigate to the player's location. 
   Example: "Go to player Steve", "Head towards Alex", "Move to player Notch", "Come to papa", "Come here".
   If no parameters are provided, the bot will move to username from begging of the message at 3 blocks close.`;

// Define parameters for the GoToPlayer action
export const parameters = z.object({
  player_name: z
    .string()
    .nullable()
    .describe("The name of the player to go to."),
  closeness: z.number().nullable().describe("How close to get to the player."),
});

// Implement the GoToPlayer action
export async function execute(args: any = {}) {
  // Riding in the owner's boat: getting out would leave the bot in the water
  if (ridingWithOwner()) {
    bot.chat("I'm right here in the boat with you.");
    return;
  }
  // Validate arguments
  const parsed = parameters.parse(args);

  let { player_name, closeness } = parsed || {};
  // Default value for closeness
  closeness = closeness || 3;
  let targetPlayer;
  
  if (player_name) {
    targetPlayer = bot.players[player_name]?.entity;
    if (!targetPlayer) {
      const known = lastKnownOwnerPosition();
      if (bot.players[player_name] && known) {
        // Out of sight, but we know where they were or said they are: go there
        const x = Math.round(known.x), z = Math.round(known.z);
        const far = Math.round(Math.hypot(bot.entity.position.x - x, bot.entity.position.z - z));
        tellOwner(`I can't see you yet; heading to where you last were (${x}, ${z}), ${far} blocks away.`);
        const arrived = await travelTo(() => ({ x: known.x, y: known.y, z: known.z }), {
          range: closeness,
          onProgress: (percent) => tellOwner(`Coming: ${percent}% of the way.`),
        });
        if (isCommandCancelled()) return;
        tellOwner(arrived ? "I'm here! Where are you?" : "I got stuck on the way.");
        return;
      }
      if (bot.players[player_name]) {
        // Online but out of sight: ask for coordinates, which the fast path turns into a trip
        tellOwner(
          `I can't see you from here. Tell me your coordinates (press F3), like: come to 100 64 -200`
        );
      } else {
        bot.chat(`Could not find player ${player_name}. They might be offline.`);
      }
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

  const targetName = targetPlayer.username || targetPlayer.name;
  if (!targetName) {
    bot.chat(`Could not determine the target player's name.`);
    return;
  }

  // Far away but visible: travel in legs toward wherever the player is now
  const distance = targetPlayer.position.distanceTo(bot.entity.position);
  if (distance > LONG_TRIP_BLOCKS) {
    tellOwner(`Coming! You're about ${Math.round(distance)} blocks away.`);
    const arrived = await travelTo(
      () => {
        const p = bot.players[targetName]?.entity;
        return p ? { x: p.position.x, y: p.position.y, z: p.position.z } : null;
      },
      { range: closeness, onProgress: (percent) => tellOwner(`Coming: ${percent}% of the way.`) }
    );
    if (isCommandCancelled()) return;
    if (arrived) {
      tellOwner("I'm here!");
      return;
    }
    // Fall through to the short-range methods below
  }

  bot.chat(`Heading towards ${targetName}.`);
  
  // Try to use the dedicated goToPlayer function first which uses GoalFollow
  try {
    const success = await goToPlayer(targetName, closeness);
    if (success) {
      await bot.lookAt(targetPlayer.position.offset(0, 1.6, 0));
      return;
    }
  } catch (error) {
    console.log(`Error using goToPlayer: ${error}. Trying alternative method...`);
  }

  // If GoalFollow fails, try with enhanced GoalNear approach
  try {
    // The shared walking rules (never through the owner's walls; sprinting is on by default)
    pathing.setMovements(walkingRules(bot));
    
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
