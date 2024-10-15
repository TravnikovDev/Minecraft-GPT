// Path: src/actions/GatherWood.ts

import { z } from "zod";
import { __actionsDelay } from "../utils/utility";
import { gatherWood } from "../actions/gatherWood";

export const description = `When user asks the bot to gather wood, the bot will search for wood blocks nearby and gather them.
The bot will continue gathering wood until the specified number of logs is reached. 
Example: "Gather wood", "Collect some logs", "Collect 6 wood", "Need some wood".
If no parameters are provided, the bot will gather 32 logs at radius of 64 blocks.`;

// Define parameters for the GatherWood action
export const parameters = z.object({
  num: z.number().describe("The number of wood logs to gather."),
});

// Implement the GatherWood action
export async function execute(args: any) {
  console.log(`Executing GatherWood with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error("Invalid parameters for GatherWood action.");
    return;
  }

  let { num } = parsed.data;
  // Default values for maxDistance and num
  let maxDistance = 64;
  num = num || 32;

  gatherWood(num, maxDistance);
}
