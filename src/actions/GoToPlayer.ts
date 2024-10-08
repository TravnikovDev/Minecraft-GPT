// Path: src/actions/GoToPlayer.ts

import { z } from "zod";
import { bot } from "../index";
import { goals } from "mineflayer-pathfinder";

// Define parameters for the GoToPlayer action
export const parameters = z.object({
  player_name: z.string().describe("The name of the player to go to."),
  closeness: z.number().describe("How close to get to the player."),
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

  const { player_name, closeness } = parsed.data;
  const targetPlayer = bot.players[player_name]?.entity;

  if (targetPlayer) {
    bot.pathfinder.setGoal(
      new goals.GoalNear(
        targetPlayer.position.x,
        targetPlayer.position.y,
        targetPlayer.position.z,
        closeness
      )
    );
    bot.chat(
      `Heading towards ${player_name}, getting ${closeness} blocks close.`
    );
  } else {
    bot.chat(`Could not find player ${player_name}.`);
  }
}
