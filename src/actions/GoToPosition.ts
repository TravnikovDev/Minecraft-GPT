// Path: src/actions/GoToPosition.ts

import { z } from "zod";
import { BotActions } from "./types";
import { bot } from "../index";
import { goals, Movements } from "mineflayer-pathfinder";

// Define parameters for the GoToPosition action
export const parameters = z.object({
  x: z.number().describe("The x-coordinate to go to."),
  y: z.number().describe("The y-coordinate to go to."),
  z: z.number().describe("The z-coordinate to go to."),
  minDistance: z
    .number()
    .optional()
    .describe("The minimum distance to stop from the target position."),
});

// Register the action with zodFunction for validation
export const GoToPositionFunction = {
  name: BotActions.GoToPosition,
  parameters: parameters,
};

// Implement the GoToPosition action
export async function execute(args: any) {
  console.log(`Executing GoToPosition with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(
      `Missing or invalid parameters for GoToPosition: x, y, or z are undefined or incorrect.`
    );
    return;
  }

  const { x, y, z, minDistance } = parsed.data;

  // Set goal using pathfinder
  bot.pathfinder.setMovements(new Movements(bot));
  try {
    await bot.pathfinder.goto(new goals.GoalNear(x, y, z, minDistance ?? 50));
    console.log(`You have reached ${x}, ${y}, ${z}.`);
  } catch (error) {
    console.error(`Failed to reach ${x}, ${y}, ${z}:`, error);
  }
}
