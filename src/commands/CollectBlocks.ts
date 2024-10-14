// Path: src/actions/CollectBlock.ts

import { z } from "zod";
import { bot } from "../index";
import { Movements } from "mineflayer-pathfinder";
import { breakBlockAt, pickupNearbyItems } from "../actions/worldInteraction";

export const description = `The user asks the bot to collect a certain number of blocks of a specific type. The bot will 
search for and collect the specified blocks. Example: "Collect 5 diamonds.", "Gather 10 iron ores."`;

// Define parameters for the CollectBlock action
export const parameters = z.object({
  blockType: z.string().describe("The type of block to collect."),
  range: z
    .number()
    .optional()
    .describe("The maximum distance to search for blocks."),
  num: z.number().describe("The number of blocks to collect."),
  exclude: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      })
    )
    .describe("The positions to exclude from collection."),
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

  let { blockType, range, num, exclude } = parsed.data;

  range = range || 8;
  num = num || 1;

  let blockTypes = [blockType];
  // Add variants
  if (
    [
      "coal",
      "diamond",
      "emerald",
      "iron",
      "gold",
      "lapis_lazuli",
      "redstone",
    ].includes(blockType)
  ) {
    blockTypes.push(`${blockType}_ore`);
  }
  if (blockType.endsWith("ore")) {
    blockTypes.push(`deepslate_${blockType}`);
  }
  if (blockType === "dirt") {
    blockTypes.push("grass_block");
  }

  let collected = 0;

  for (let i = 0; i < num; i++) {
    let blocks = bot.findBlocks({
      matching: (block) => blockTypes.includes(block.name),
      maxDistance: range,
      count: 100,
    });

    if (exclude.length > 0) {
      blocks = blocks.filter(
        (block) =>
          !exclude.some(
            (pos) => pos.x === block.x && pos.y === block.y && pos.z === block.z
          )
      );
    }

    const movements = new Movements(bot);
    movements.dontMineUnderFallingBlock = false;

    if (blocks.length === 0) {
      if (collected === 0) console.log(`No ${blockType} nearby to collect.`);
      else console.log(`No more ${blockType} nearby to collect.`);
      break;
    }

    const blockPosition = blocks[0];
    const block = bot.blockAt(blockPosition);
    if (!block) {
      console.log(`Block at position ${blockPosition} not found.`);
      continue;
    }
    await bot.tool.equipForBlock(block);
    const itemId = bot.heldItem ? bot.heldItem.type : null;
    if (!block.canHarvest(itemId)) {
      console.log(`Don't have the right tools to harvest ${blockType}.`);
      return;
    }
    try {
      await breakBlockAt(blockPosition.x, blockPosition.y, blockPosition.z);
      await pickupNearbyItems(bot);

      collected++;
    } catch (err) {
      if (err instanceof Error && err.name === "NoChests") {
        console.log(
          `Failed to collect ${blockType}: Inventory full, no place to deposit.`
        );
        break;
      } else {
        if (err instanceof Error) {
          console.log(`Failed to collect ${blockType}: ${err.message}.`);
        } else {
          console.log(`Failed to collect ${blockType}: ${String(err)}.`);
        }
        continue;
      }
    }
  }
  bot.chat(`Collected ${collected} ${blockType}.`);
}
