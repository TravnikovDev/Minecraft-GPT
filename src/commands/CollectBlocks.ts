// Path: src/actions/CollectBlock.ts

import { z } from "zod";
import { bot } from "../index";
import { collectBlock } from "../actions/collectBlock";

export const description = `The user asks the bot to collect a certain number of blocks of a specific type. The bot will 
search for and collect the specified blocks. Example: "Collect 5 diamonds", "Gather 10 iron ore"`;

// Define parameters for the CollectBlock action
export const parameters = z.object({
  blockType: z.string().describe("The type of block to collect."),
  range: z
    .number()
    .optional()
    .describe("The maximum distance to search for blocks."),
  num: z.number().describe("The number of blocks to collect."),
});

// Implement the CollectBlock action
export async function execute(args: any) {
  console.log(`Executing CollectBlock with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for CollectBlock.`);
    return;
  }

  let { blockType, range, num } = parsed.data;

  const result = await collectBlock(blockType, range, num);

  if (result) {
    bot.chat(`Collected ${num} ${blockType}.`);
  } else {
    bot.chat(`Failed to collect ${num} ${blockType}.`);
  }
}
