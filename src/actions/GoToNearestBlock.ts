import { Bot } from "mineflayer";
import { z } from "zod";
import { BotActions } from "./types";
import { bot } from "../index";
import { goToPosition } from "../managers/movementManager";

// Define parameters for the GoToNearestBlock action
export const parameters = z.object({
  blockType: z.string().describe("The type of the block to go to."),
  minDistance: z.number().optional().describe("Minimum distance to the block."),
  range: z.number().optional().describe("Search range for the block."),
});

// Register the action with zodFunction for validation
export const GoToNearestBlockFunction = {
  name: BotActions.GoToNearestBlock,
  parameters: parameters,
};

// Function to get the nearest block of a specific type using Mineflayer
function getNearestBlock(bot: Bot, blockType: string, maxDistance: number) {
  const blocks = bot.findBlocks({
    matching: (block) => block.name === blockType,
    maxDistance: maxDistance,
    count: 1,
  });

  if (blocks.length === 0) return null;

  const nearestBlockPosition = blocks[0];
  return bot.blockAt(nearestBlockPosition);
}

// Implement the GoToNearestBlock action
export async function execute(args: any) {
  console.log(`Executing GoToNearestBlock with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(
      `Missing or invalid parameters for GoToNearestBlock:`,
      parsed.error
    );
    return;
  }

  const { blockType, minDistance, range } = parsed.data;
  const MAX_RANGE = 512;
  let searchRange = range;
  if (range > MAX_RANGE) {
    console.log(`Maximum search range capped at ${MAX_RANGE}.`);
    searchRange = MAX_RANGE;
  }

  const block = getNearestBlock(bot, blockType, searchRange || 50);
  if (!block) {
    console.log(`Could not find any ${blockType} in ${searchRange} blocks.`);
    return;
  }

  console.log(`Found ${blockType} at ${block.position}.`);
  await goToPosition({
    x: block.position.x,
    y: block.position.y,
    z: block.position.z,
    minDistance: minDistance,
  });
}
