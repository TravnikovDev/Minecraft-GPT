// Path: src/actions/FollowPlayer.ts

import { z } from "zod";
import { followPlayer } from "../actions/movement";
import { getNearbyPlayerNames } from "../actions/world";
import { bot } from "..";

export const description = `When user asks the bot to follow a player, the bot will follow the player at a specified distance.
Example: "Follow player Steve at a distance of 2 blocks.", "Follow me", "Let' go", "Let' go together".`;

// Define parameters for the FollowPlayer action
export const parameters = z.object({
  player_name: z.string().describe("The name of the player to follow."),
  distance: z
    .number()
    .optional()
    .describe("The distance to keep from the player."),
});

// Implement the FollowPlayer action
export async function execute(args: any) {
  console.log(`Executing FollowPlayer with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(
      `Missing parameters for FollowPlayer: player_name or distance is undefined.`
    );
    return;
  }

  let { player_name, distance } = parsed.data;
  distance = distance || 3;

  let userToFollow;
  if (player_name) {
    userToFollow = player_name;
  } else {
    const players = getNearbyPlayerNames(220);
    userToFollow = players[0];
  }

  const result = await followPlayer(userToFollow, distance);
  if (result) {
    bot.chat(`Following ${player_name}`);
  } else {
    bot.chat(`Failed to follow ${player_name}`);
  }
}
