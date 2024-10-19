// Path: src/actions/SetBasement.ts

import { z } from "zod";
import { bot } from "../index";
import { buildShelter } from "../actions/building";

export const description = `When the user asks the bot to set up a basement, the bot will dig a diagonal tunnel down and 
create a room at the end of the tunnel. Example: "Set up a basement with a room size of 3x3x4",
"Please build a basement", "Let's build a basement".
If no parameters are provided, the bot will use default values 3x3x4 for room size.`;

// Define parameters for SetBasement action
export const parameters = z.object({
  roomSize: z
    .object({
      width: z.number(),
      height: z.number(),
      length: z.number(),
    })
    .optional()
    .describe("Dimensions of the basement room"),
});

// Implement the SetBasement action
export async function execute(args: any) {
  console.log(`Executing SetBasement with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for SetBasement:`, parsed.error);
    return;
  }

  let { roomSize } = parsed.data;

  // Default values for room size
  roomSize = roomSize || { width: 3, height: 3, length: 4 };
  const tunnelDepth = 6; // Adjust as needed

  try {
    await buildShelter(roomSize, tunnelDepth);
    bot.chat("Shelter setup complete ⾕");
  } catch (error) {
    bot.chat(`Error during up basement: ${error}`);
  }
}
