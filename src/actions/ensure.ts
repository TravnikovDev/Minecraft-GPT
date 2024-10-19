/*
    Purpose: This file will store various functions used to ensure the bot has needed items for in-game actions.
*/

import { bot } from "..";
import { collectBlock } from "./collectBlock";
import { craftRecipe } from "./crafting";
import { ensurePickaxe } from "./ensureTools";
import { gatherWood } from "./gatherWood";
import { getItemCount } from "./inventory";
import { moveAway } from "./movement";

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

// Ensure a specific number of chests
export const ensureChests = async (quantity: number = 1): Promise<boolean> => {
  console.log(`Bot: Checking for ${quantity} chest(s)...`);

  // Count the number of chests the bot already has
  let chestCount = bot.inventory
    .items()
    .filter((item) => item.name === "chest").length;

  if (chestCount >= quantity) {
    console.log(`Bot: Already has ${quantity} or more chest(s).`);
    return true;
  }

  while (chestCount < quantity) {
    const planksEnsured = await ensurePlanks(8 * (quantity - chestCount)); // 8 planks per chest
    if (!planksEnsured) {
      console.error("Bot: Failed to ensure planks for chest(s).");
      return false;
    }

    // Craft the chest(s)
    const crafted = await craftRecipe("chest", quantity - chestCount);
    if (crafted) {
      chestCount += quantity;
      bot.chat(`I have crafted ${quantity} chest(s).`);
      console.log(`Bot: ${quantity} chest(s) crafted.`);
      return chestCount >= quantity;
    } else {
      console.error("Bot: Failed to craft chest(s).");
    }
  }
  return chestCount >= quantity;
};

// Ensure a specific number of furnaces
export const ensureFurnaces = async (
  quantity: number = 1
): Promise<boolean> => {
  console.log(`Bot: Checking for ${quantity} furnace(s)...`);

  // Count the number of furnaces the bot already has
  let furnaceCount = bot.inventory
    .items()
    .filter((item) => item.name === "furnace").length;

  if (furnaceCount >= quantity) {
    console.log(`Bot: Already has ${quantity} or more furnace(s).`);
    return true;
  }

  while (furnaceCount < quantity) {
    const stoneEnsured = await ensureCobblestone(8 * (quantity - furnaceCount)); // 8 stone blocks per furnace
    if (!stoneEnsured) {
      console.error("Bot: Failed to ensure stone for furnace(s).");
      return false;
    }

    // Craft the furnace(s)
    const crafted = await craftRecipe("furnace", quantity - furnaceCount);
    if (crafted) {
      furnaceCount += quantity;
      bot.chat(`I have crafted ${quantity} furnace(s).`);
      console.log(`Bot: ${quantity} furnace(s) crafted.`);
      return furnaceCount >= quantity;
    } else {
      console.error("Bot: Failed to craft furnace(s).");
    }
  }
  return furnaceCount >= quantity;
};

// Ensure a specific number of torches
export const ensureTorches = async (quantity: number = 1): Promise<boolean> => {
  console.log(`Bot: Checking for ${quantity} torch(es)...`);

  // Count the number of torches the bot already has
  let torchCount = bot.inventory
    .items()
    .filter((item) => item.name === "torch").length;

  if (torchCount >= quantity) {
    console.log(`Bot: Already has ${quantity} or more torch(es).`);
    return true;
  }

  while (torchCount < quantity) {
    const sticksEnsured = await ensureSticks(quantity - torchCount); // 1 stick per 4 torches
    const coalEnsured = await ensureCoal(
      Math.ceil((quantity - torchCount) / 4)
    ); // 1 coal per 4 torches

    if (!sticksEnsured || !coalEnsured) {
      console.error("Bot: Failed to ensure sticks or coal for torch(es).");
      return false;
    }

    // Craft the torch(es)
    const crafted = await craftRecipe("torch", quantity - torchCount);
    if (crafted) {
      torchCount += quantity;
      bot.chat(`I have crafted ${quantity} torch(es).`);
      console.log(`Bot: ${quantity} torch(es) crafted.`);
      return torchCount >= quantity;
    } else {
      console.error("Bot: Failed to craft torch(es).");
    }
  }
  return torchCount >= quantity;
};

// Ensure a campfire
export const ensureCampfire = async (): Promise<boolean> => {
  console.log("Bot: Checking for a campfire...");

  let hasCampfire = bot.inventory
    .items()
    .some((item) => item.name === "campfire");

  if (hasCampfire) {
    console.log("Bot: Campfire is already available.");
    return true;
  }

  const logsEnsured = await ensurePlanks(3); // Need 3 logs for a campfire
  const sticksEnsured = await ensureSticks(3); // Need 3 sticks for a campfire
  const coalEnsured = await ensureCoal(1); // Need 1 coal or charcoal for a campfire

  if (!logsEnsured || !sticksEnsured || !coalEnsured) {
    console.error("Bot: Failed to ensure resources for campfire.");
    return false;
  }

  const crafted = await craftRecipe("campfire", 1);
  if (crafted) {
    bot.chat("I have crafted a campfire.");
    console.log("Bot: Campfire crafted.");
    return true;
  } else {
    console.error("Bot: Failed to craft campfire.");
  }

  return hasCampfire;
};

// Helper function to gather cobblestone
export const ensureCobblestone = async (
  requiredCobblestone: number,
  maxDistance: number = 4
): Promise<boolean> => {
  let cobblestoneCount = getItemCount("cobblestone");

  while (cobblestoneCount < requiredCobblestone) {
    console.log("Bot: Gathering more cobblestone...");
    const cobblestoneShortage = requiredCobblestone - cobblestoneCount;

    try {
      await collectBlock("stone", cobblestoneShortage, maxDistance);
    } catch (err) {
      if (err instanceof Error && err.message.includes("right tools")) {
        await ensurePickaxe();
        continue;
      } else {
        console.error("Error collecting cobblestone:", err);
        moveAway(30);
        continue;
      }
    }

    cobblestoneCount = getItemCount("cobblestone");
  }

  console.log("Bot: Collected enough cobblestone.");
  return true;
};

export const ensureCoal = async (
  neededAmount: number,
  maxDistance: number = 4
): Promise<boolean> => {
  console.log("Bot: Checking for coal...");
  let coalCount = getItemCount("coal");

  while (coalCount < neededAmount) {
    console.log("Bot: Gathering more coal...");
    const coalShortage = neededAmount - coalCount;

    try {
      await collectBlock("stone", coalShortage, maxDistance);
    } catch (err) {
      if (err instanceof Error && err.message.includes("right tools")) {
        await ensurePickaxe();
        continue;
      } else {
        console.error("Error collecting cobblestone:", err);
        moveAway(30);
        continue;
      }
    }

    coalCount = getItemCount("cobblestone");
  }

  console.log("Bot: Collected enough cobblestone.");
  return true;
};
