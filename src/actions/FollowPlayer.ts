// Path: src/actions/FollowPlayer.ts

import { z } from "zod";
import { BotActions } from "./types";
import { bot } from "../index";
import { goals, Movements } from "mineflayer-pathfinder";

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

// Register the action with zodFunction for validation
export const FollowPlayerFunction = {
  name: BotActions.FollowPlayer,
  parameters: parameters,
};

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

  const playerEntity = bot.players[player_name]?.entity;

  if (!playerEntity) {
    bot.chat(`Could not find player ${player_name}.`);
    return;
  }

  const move = new Movements(bot);
  bot.pathfinder.setMovements(move);
  bot.pathfinder.setGoal(new goals.GoalFollow(playerEntity, distance), true);
  bot.chat(`You are now actively following player ${player_name}.`);

  let lastTime = Date.now();
  let stuckTime = 0;
  let lastPos = bot.entity.position.clone();

  await new Promise((resolve) => setTimeout(resolve, 500));
  const delta = Date.now() - lastTime;
  const farAway =
    bot.entity.position.distanceTo(playerEntity.position) > distance + 1;
  if (farAway && bot.entity.position.distanceTo(lastPos) <= 2) {
    stuckTime += delta;
    if (stuckTime > 10000) {
      bot.chat(`Got stuck, attempting to move away.`);
      bot.pathfinder.stop();
      // Execute unstuck logic if needed here
      return;
    }
  }
}
