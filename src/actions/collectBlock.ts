import { bot } from "../index";
import pf from "mineflayer-pathfinder";
import { Block } from "prismarine-block";
import * as world from "./world.js";
import { __actionsDelay } from "../utils/utility.js";
import { breakBlockAt, pickupNearbyItems } from "./worldInteraction.js";

export async function collectBlock(
  blockType: string,
  num = 1,
  range = 16
): Promise<boolean> {
  if (num < 1) {
    console.log(`Invalid number of blocks to collect: ${num}.`);
    return false;
  }

  let blockTypes = [blockType];

  // Add block variants
  if (
    [
      "coal",
      "diamond",
      "emerald",
      "iron",
      "gold",
      "lapis_lazuli",
      "redstone",
      "copper",
    ].includes(blockType)
  ) {
    blockTypes.push(`${blockType}_ore`, `deepslate_${blockType}_ore`);
  }
  if (blockType.endsWith("ore")) {
    blockTypes.push(`deepslate_${blockType}`);
  }
  if (blockType === "dirt") {
    blockTypes.push("grass_block");
  }

  let collected = 0;

  while (collected < num) {
    let blocks = world.getNearestBlocks(bot, blockTypes, range);

    if (blocks.length === 0) {
      if (collected === 0) console.log(`No ${blockType} nearby to collect.`);
      else console.log(`No more ${blockType} nearby to collect.`);
      break;
    }

    const block = blocks[0];

    try {
      // Equip appropriate tool
      if (bot.game.gameMode !== "creative") {
        await bot.tool.equipForBlock(block);
        const itemId = bot.heldItem ? bot.heldItem.type : null;
        if (!block.canHarvest(itemId)) {
          console.log(`Don't have right tools to harvest ${block.name}.`);
          // Optionally, attempt to craft or obtain the required tool
          break;
        }
      }

      // Implement vein mining
      const veinBlocks = findVeinBlocks(block, 100, range, 1);

      for (const veinBlock of veinBlocks) {
        if (collected >= num) break;

        // Move to the block using pathfinder
        const goal = new pf.goals.GoalGetToBlock(
          veinBlock.position.x,
          veinBlock.position.y,
          veinBlock.position.z
        );
        await bot.pathfinder.goto(goal);

        // Break the block and collect drops
        await mineAndCollect(veinBlock);

        collected++;

        // Check if inventory is full
        if (bot.inventory.emptySlotCount() === 0) {
          console.log("Inventory is full, cannot collect more items.");
          break;
        }
      }
    } catch (err) {
      console.log(`Failed to collect ${blockType}: ${err}.`);
      continue;
    }
  }

  console.log(`Collected ${collected} ${blockType}(s).`);
  return collected > 0;
}

// Helper function to mine a block and collect drops
async function mineAndCollect(block: Block): Promise<void> {
  // Break the block
  await breakBlockAt(block.position.x, block.position.y, block.position.z);
  // Use your existing function to pick up nearby items
  await pickupNearbyItems(bot, 5);
}

// Function to find connected blocks (vein mining)
function findVeinBlocks(
  startBlock: Block,
  maxBlocks = 100,
  maxDistance = 16,
  floodRadius = 1
): Block[] {
  const veinBlocks: Block[] = [];
  const visited = new Set<string>();
  const queue: Block[] = [startBlock];

  while (queue.length > 0 && veinBlocks.length < maxBlocks) {
    const block = queue.shift();
    if (!block) continue;
    const key = block.position.toString();

    if (visited.has(key)) continue;
    visited.add(key);

    if (block.name !== startBlock.name) continue;
    if (block.position.distanceTo(startBlock.position) > maxDistance) continue;

    veinBlocks.push(block);

    // Check neighboring blocks within floodRadius
    for (let dx = -floodRadius; dx <= floodRadius; dx++) {
      for (let dy = -floodRadius; dy <= floodRadius; dy++) {
        for (let dz = -floodRadius; dz <= floodRadius; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue; // Skip the current block
          const neighborPos = block.position.offset(dx, dy, dz);
          const neighborBlock = bot.blockAt(neighborPos);
          if (neighborBlock && !visited.has(neighborPos.toString())) {
            queue.push(neighborBlock);
          }
        }
      }
    }
  }

  return veinBlocks;
}
