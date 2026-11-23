// Path: src/commands/Unstack.ts

import { z } from "zod";
import { bot } from "../index";
import { moveAway } from "../actions/movement";

export const description = `When the user says the bot is stuck or asks it to move away, the bot walks a short distance
away from its current position. Example: "Unstack", "You're stuck", "Get out of there", "Move away".`;

// Define parameters for the Unstack action
export const parameters = z.object({
  distance: z
    .number()
    .nullable()
    .describe("How far to move away, in blocks (default 10)."),
});

// Implement the Unstack action: one attempt to move away. (It used to be an
// endless monitoring loop whose delay was never awaited, which froze the bot.)
export async function execute(args: any): Promise<void> {
  console.log(`Executing Unstack with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Missing or invalid parameters for Unstack.`);
    return;
  }

  const distance = parsed.data.distance ?? 10;
  const moved = await moveAway(distance);
  bot.chat(moved ? "I'm free!" : "I couldn't get out of here.");
}
