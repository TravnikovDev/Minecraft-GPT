// Path: src/actions/Unstack.ts

import { z } from "zod";
import { BotCommands } from "./types";
import { bot } from "../index";
import { Vec3 } from "vec3";
import { moveAway } from "../utils/movement";

export const description = `When user asks the bot to unstack, the bot will check if it is stuck at the current position.
If the bot is stuck, it will attempt to move away by the specified distance. Example: "Unstack", "Move away".`;

// Define parameters for the Unstack action
export const parameters = z.object({
  distance: z
    .number()
    .optional()
    .describe("The distance to move away when stuck."),
  maxStuckTime: z
    .number()
    .optional()
    .describe(
      "Maximum time in seconds before considering the bot to be stuck."
    ),
});

// Register the action with zodFunction for validation
export const UnstackFunction = {
  name: BotCommands.Unstack,
  parameters: parameters,
};

// Implement the Unstack action
export async function execute(args: any) {
  console.log(`Executing Unstack with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Missing or invalid parameters for Unstack.`);
    return;
  }

  const { distance, maxStuckTime } = parsed.data;
  let prevLocation: Vec3 | null = null;
  let stuckTime = 0;
  let lastTime = Date.now();

  // Loop to keep checking if the bot is stuck
  while (true) {
    const delta = (Date.now() - lastTime) / 1000;
    lastTime = Date.now();
    const currentPosition = bot.entity.position;

    if (
      prevLocation &&
      prevLocation.distanceTo(currentPosition) < (distance ?? 10)
    ) {
      stuckTime += delta;
    } else {
      prevLocation = currentPosition.clone();
      stuckTime = 0;
    }

    if (stuckTime > (maxStuckTime ?? 1000)) {
      // Default to 5 seconds if maxStuckTime is undefined
      console.log("I'm stuck! Attempting to unstack.");
      await moveAway(distance ?? 10);
      stuckTime = 0;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
