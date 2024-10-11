// Path: src/actions/CraftBackupTools.ts

import { z } from "zod";
import { BotActions } from "./types";
import { bot } from "../index";
import { Vec3 } from "vec3";
import { craftRecipe } from "../utils/crafting";

// Define parameters for CraftBackupTools action
export const parameters = z.object({
  storageLocation: z
    .object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
    })
    .describe("Coordinates of the storage chest"),
  tools: z
    .object({
      stoneAxe: z.number(),
      stonePickaxe: z.number(),
    })
    .describe("Quantity of backup tools to craft"),
});

// Implement the CraftBackupTools action
export async function execute(args: any) {
  console.log(`Executing CraftBackupTools with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for CraftBackupTools:`, parsed.error);
    return;
  }

  const { storageLocation, tools } = parsed.data;
  const { stoneAxe, stonePickaxe } = tools;
  const storagePos = new Vec3(
    storageLocation.x,
    storageLocation.y,
    storageLocation.z
  );

  // Craft the specified backup tools
  await craftRecipe("stone_axe", stoneAxe);
  await craftRecipe("stone_pickaxe", stonePickaxe);

  // Open the storage chest
  const chestBlock = bot.blockAt(storagePos);
  if (chestBlock && chestBlock.name === "chest") {
    const chest = await bot.openChest(chestBlock);

    // Move crafted items to the storage chest
    const toolsToStore = ["stone_axe", "stone_pickaxe"];
    for (const tool of toolsToStore) {
      const item = bot.inventory.items().find((i) => i.name === tool);
      if (item) {
        await chest.deposit(item.type, null, item.count);
        bot.chat(`Stored ${item.count} ${item.name}(s) in the backup storage.`);
      }
    }
    chest.close();
    bot.chat("All backup tools have been stored in the chest.");
  } else {
    bot.chat("Could not find the storage chest at the specified location.");
  }
}
