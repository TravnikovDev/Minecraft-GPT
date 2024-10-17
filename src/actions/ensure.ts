/*
    Purpose: This file will store various functions used to ensure the bot has needed items for in-game actions.
*/

import { bot } from "..";
import { craftRecipe } from "./crafting";
import { gatherWood } from "./gatherWood";
import { getItemCount } from "./inventory";
import { moveAway } from "./movement";

// Constants for crafting and gathering
const PLANKS_PER_LOG = 4;
const STICKS_PER_PLANK = 2;
const MIN_LOGS_FOR_PICKAXE = 5;
const MIN_LOGS_FOR_CRAFTING_TABLE = 2;

// Helper function to ensure a wooden pickaxe
export const ensurePickaxe = async (): Promise<boolean> => {
  console.log("Bot: Checking for a pickaxe...");

  let hasPickaxe = bot.inventory
    .items()
    .some((item) => item.name === "wooden_pickaxe");

  if (hasPickaxe) {
    console.log("Bot: Pickaxe is available.");
    return true;
  }

  while (!hasPickaxe) {
    const logsCount = getItemCount("log");

    if (logsCount >= MIN_LOGS_FOR_PICKAXE) {
      await ensureCraftingTable();
      // Ensure planks and sticks using existing functions
      const planksEnsured = await ensurePlanks(12);
      const sticksEnsured = await ensureSticks(8);

      if (!planksEnsured || !sticksEnsured) {
        console.error("Bot: Failed to ensure planks or sticks.");
        continue;
      }

      // Craft pickaxe
      hasPickaxe = await craftRecipe("wooden_pickaxe", 1);
      if (hasPickaxe) {
        bot.chat("I have crafted a wooden pickaxe.");
        console.log("Bot: Wooden pickaxe crafted.");
      } else {
        console.error("Bot: Failed to craft wooden pickaxe.");
      }
    } else {
      await gatherWood(MIN_LOGS_FOR_PICKAXE);
      console.error("Bot: Not enough logs to craft a wooden pickaxe.");
    }
  }

  return hasPickaxe;
};

// Helper function to ensure a crafting table
export const ensureCraftingTable = async (): Promise<boolean> => {
  console.log("Bot: Checking for a crafting table...");

  let hasCraftingTable = bot.inventory
    .items()
    .some((item) => item.name.includes("crafting"));

  if (hasCraftingTable) {
    console.log("Bot: Crafting table is available.");
    return true;
  }

  while (!hasCraftingTable) {
    const logsCount = getItemCount("log");

    if (logsCount >= MIN_LOGS_FOR_CRAFTING_TABLE) {
      // Ensure planks using existing function
      const planksEnsured = await ensurePlanks(4);
      if (!planksEnsured) {
        console.error("Bot: Failed to ensure planks.");
        continue;
      }

      // Craft crafting table
      hasCraftingTable = await craftRecipe("crafting_table", 1);
      if (hasCraftingTable) {
        bot.chat("I have made a crafting table.");
        console.log("Bot: Crafting table crafted.");
      } else {
        console.error("Bot: Failed to craft crafting table.");
      }
    } else {
      await gatherWood(MIN_LOGS_FOR_CRAFTING_TABLE);
      console.error("Bot: Not enough logs to make a crafting table.");
    }
  }

  return hasCraftingTable;
};

// Helper function to ensure a specific amount of planks
export const ensurePlanks = async (neededAmount: number): Promise<boolean> => {
  console.log("Bot: Checking for planks...");

  let planksCount = getItemCount("planks");

  if (neededAmount <= planksCount) {
    console.log("Bot: Have enough planks.");
    return true;
  }

  while (neededAmount > planksCount) {
    const logsCount = getItemCount("log");
    const logType = bot.inventory
      .items()
      .find((item) => item.name.includes("log"))
      ?.name.replace("_log", "");

    if (logsCount >= Math.ceil((neededAmount - planksCount) / PLANKS_PER_LOG)) {
      const crafted = await craftRecipe(
        `${logType}_planks`,
        neededAmount - planksCount
      );
      if (crafted) {
        planksCount = getItemCount("planks");
        bot.chat(
          `I have made ${Math.abs(
            neededAmount - planksCount
          )} ${logType} planks.`
        );
        console.log(`Bot: ${logType} planks crafted.`);
      } else {
        console.error("Bot: Failed to craft planks.");
        return false;
      }
    } else {
      const logsNeeded = Math.ceil(
        (neededAmount - planksCount) / PLANKS_PER_LOG
      );
      await gatherWood(logsNeeded);
      console.error("Bot: Not enough logs for planks.");
    }
  }

  return planksCount >= neededAmount;
};

// Helper function to ensure a specific amount of sticks
export const ensureSticks = async (neededAmount: number): Promise<boolean> => {
  console.log("Bot: Checking for sticks...");

  let sticksCount = getItemCount("stick");

  if (neededAmount <= sticksCount) {
    console.log("Bot: Have enough sticks.");
    return true;
  }

  while (neededAmount > sticksCount) {
    const planksCount = getItemCount("planks");
    const planksNeeded = Math.ceil(
      (neededAmount - sticksCount) / STICKS_PER_PLANK
    );

    if (planksCount >= planksNeeded) {
      const crafted = await craftRecipe("stick", neededAmount - sticksCount);
      if (crafted) {
        sticksCount = getItemCount("stick");
        bot.chat(`I have made ${Math.abs(neededAmount - sticksCount)} sticks.`);
        console.log(`Bot: Sticks crafted.`);
      } else {
        console.error("Bot: Failed to craft sticks.");
        return false;
      }
    } else {
      await ensurePlanks(planksNeeded);
      console.error("Bot: Not enough planks for sticks.");
    }
  }

  return sticksCount >= neededAmount;
};

export async function ensureLocation(
  radius: number = 100,
  requiredResources: { wood: number; coal: number; iron: number } = {
    wood: 36,
    coal: 54,
    iron: 72,
  }
): Promise<boolean> {
  console.log(
    `Scanning location with radius ${radius} for required resources:`,
    requiredResources
  );

  const { wood, coal, iron } = requiredResources;

  while (true) {
    // Initialize resource counters
    let woodCount = 0;
    let coalCount = 0;
    let ironCount = 0;

    // Get block IDs for logs
    const logBlockNames = Object.keys(bot.registry.blocksByName).filter(
      (name) => name.endsWith("_log") || name.endsWith("_stem")
    );
    const logBlockIds = logBlockNames.map(
      (name) => bot.registry.blocksByName[name].id
    );

    // Scan for wood logs
    const woodBlocks = bot.findBlocks({
      matching: logBlockIds,
      maxDistance: radius,
      count: wood,
    });
    woodCount = woodBlocks.length;

    // Scan for coal ores
    const coalOreId = bot.registry.blocksByName["coal_ore"].id;
    const coalBlocks = bot.findBlocks({
      matching: coalOreId,
      maxDistance: radius,
      count: coal,
    });
    coalCount = coalBlocks.length;

    // Scan for iron ores
    const ironOreId = bot.registry.blocksByName["iron_ore"].id;
    const ironBlocks = bot.findBlocks({
      matching: ironOreId,
      maxDistance: radius,
      count: iron,
    });
    ironCount = ironBlocks.length;

    console.log(
      `Found resources - Wood: ${woodCount}, Coal: ${coalCount}, Iron: ${ironCount}`
    );

    // Check if resource requirements are met
    if (woodCount >= wood && coalCount >= coal && ironCount >= iron) {
      bot.chat(
        "This location is suitable for a base. It has enough wood, coal, and iron."
      );
      return true;
    } else {
      bot.chat(
        "This location is not suitable for a base. It lacks sufficient resources."
      );
      // Move away and try again
      await moveAway(60);
      // Wait some time before re-evaluating
      await bot.waitForTicks(100); // Wait for 5 seconds assuming 20 ticks per second
    }
  }
}
