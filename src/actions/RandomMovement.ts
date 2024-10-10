// Path: src/actions/RandomMovement.ts

import { z } from "zod";
import { bot } from "../index";
import { goals } from "mineflayer-pathfinder";

// Define parameters for RandomMovement action
export const parameters = z.object({
  minDistance: z.number().describe("Minimum distance to travel"),
  maxDistance: z.number().describe("Maximum distance to travel"),
});

// Implement the RandomMovement action
export async function execute(args: any) {
  console.log(`Executing RandomMovement with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for RandomMovement:`, parsed.error);
    return;
  }

  let { minDistance, maxDistance } = parsed.data;

  // Default values for min and max distance
  minDistance = minDistance || 30;
  maxDistance = maxDistance || 150;

  // Generate a random angle and distance
  const angle = Math.random() * 2 * Math.PI; // Random angle between 0 and 2π
  const distance = minDistance + Math.random() * (maxDistance - minDistance); // Random distance between min and max

  // Calculate the destination coordinates
  const destX = bot.entity.position.x + Math.cos(angle) * distance;
  const destZ = bot.entity.position.z + Math.sin(angle) * distance;
  const destY = bot.entity.position.y; // Maintain the same Y level

  // Set the bot’s goal to the destination
  bot.pathfinder.setGoal(
    new goals.GoalBlock(Math.floor(destX), Math.floor(destY), Math.floor(destZ))
  );
  bot.chat(`I'm going for a walk!`);
}