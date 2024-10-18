/*
    Purpose: This file will store various functions used to ensure the bot has needed items for in-game actions.
*/

import { bot } from "..";
import { craftRecipe } from "./crafting";
import { gatherWood } from "./gatherWood";
import { getItemCount } from "./inventory";

// Constants for crafting and gathering
const PLANKS_PER_LOG = 4;
const STICKS_PER_PLANK = 2;
const MIN_LOGS_FOR_CRAFTING_TABLE = 2;

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

  while (neededAmount >= planksCount) {
    const logsCount = getItemCount("log");
    const logType = bot.inventory
      .items()
      .find((item) => item.name.includes("log"))
      ?.name.replace("_log", "");
    const logsNeeded = Math.ceil((neededAmount - planksCount) / PLANKS_PER_LOG);

    if (logsCount >= logsNeeded) {
      const crafted = await craftRecipe(
        `${logType}_planks`,
        neededAmount - planksCount
      );
      if (crafted) {
        planksCount = getItemCount("planks");
        bot.chat(`I have made ${neededAmount} ${logType} planks.`);
        console.log(`Bot: ${logType} planks crafted.`);
      } else {
        console.error("Bot: Failed to craft planks.");
        return false;
      }
    } else {
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

  while (neededAmount >= sticksCount) {
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
