import type { Bot } from "mineflayer";
import { z } from "zod";
import { bot } from "../core/body";
import { goToPositionResult } from "../actions/movement";
import { describeFailure, wasStopped } from "../core/result";

export const description = `When user asks the bot to go to a block, the bot will search for the nearest block of the 
specified type and move towards it. If no parameters are provided, the bot will search for the nearest block within 50 blocks.`;

// Define parameters for the GoToBlock action
export const parameters = z.object({
  blockType: z.string().describe("The type of block to go to."),
  minDistance: z.number().nullable().describe("Minimum distance to the block."),
  range: z.number().nullable().describe("Maximum search range for the block."),
});

// Function to get the nearest block of a specific type
function getNearestBlock(bot: Bot, blockType: string, maxDistance: number) {
  const blocks = [];
  const botPosition = bot.entity.position;

  for (let x = -maxDistance; x <= maxDistance; x++) {
    for (let y = -maxDistance; y <= maxDistance; y++) {
      for (let z = -maxDistance; z <= maxDistance; z++) {
        const position = botPosition.offset(x, y, z);
        const block = bot.blockAt(position);
        if (block && block.name === blockType) {
          blocks.push(block);
        }
      }
    }
  }

  blocks.sort(
    (a, b) =>
      botPosition.distanceTo(a.position) - botPosition.distanceTo(b.position)
  );
  return blocks.length > 0 ? blocks[0] : null;
}

// Implement the GoToBlock action
export async function execute(args: any) {
  console.log(`Executing GoToBlock with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Missing or invalid parameters for GoToBlock.`);
    return;
  }

  let { blockType, minDistance, range } = parsed.data;
  // Default values
  minDistance = minDistance || 1;
  range = range || 50;

  const MAX_RANGE = 512;
  const searchRange = range > MAX_RANGE ? MAX_RANGE : range;

  const block = getNearestBlock(bot, blockType, searchRange);
  if (!block) {
    console.log(
      `Could not find any ${blockType} within ${searchRange} blocks.`
    );
    return;
  }

  console.log(`Found ${blockType} at ${block.position}.`);
  const result = await goToPositionResult(block.position.x, block.position.y, block.position.z, minDistance);
  if (!result.ok && !wasStopped(result)) bot.chat(`I can't get to the ${blockType.replace(/_/g, " ")}: ${describeFailure(result)}.`);
}
