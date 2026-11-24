/*
    Purpose: This file will store various functions used to ensure the bot has needed items for in-game actions.
*/

import { bot } from "../core/body";
import { getItemId } from "../utils/minecraftData";
import { collectBlock } from "./collectBlock";
import { craftRecipe } from "./crafting";
import { ensurePickaxe } from "./ensureTools";
import { gatherWood } from "./gatherWood";
import { getItemCount } from "./inventory";
import { moveAway } from "./movement";
import { isCommandCancelled } from "../core/commandContext";

// Constants for crafting and gathering
const PLANKS_PER_LOG = 4;
const STICKS_PER_PLANK = 2;
const MAX_ENSURE_ATTEMPTS = 3;

/**
 * Exit check for every ensure loop: stop when the command was cancelled or
 * after too many attempts, so a failing step can't loop forever.
 */
export function shouldGiveUp(attempt: number, what: string): boolean {
  if (isCommandCancelled()) {
    console.log(`Bot: Stopped getting ${what} (command cancelled).`);
    return true;
  }
  if (attempt > MAX_ENSURE_ATTEMPTS) {
    console.error(`Bot: Giving up on ${what} after ${MAX_ENSURE_ATTEMPTS} attempts.`);
    return true;
  }
  return false;
}

// Helper function to ensure a crafting table
export const ensureCraftingTable = async (): Promise<boolean> => {
  console.log("Bot: Checking for a crafting table...");

  let hasCraftingTable = getItemCount("crafting_table") > 0;

  if (hasCraftingTable) {
    console.log("Bot: Crafting table is available.");
    return true;
  }

  let attempt = 0;
  while (!hasCraftingTable) {
    if (shouldGiveUp(++attempt, "a crafting table")) return false;
    const planksEnsured = await ensurePlanks(4);
    if (!planksEnsured) {
      console.error("Bot: Failed to ensure planks.");
      return false;
    }

    // Craft crafting table
    hasCraftingTable = await craftRecipe("crafting_table", 1);
    if (hasCraftingTable) {
      bot.chat("I have made a crafting table.");
      console.log("Bot: Crafting table crafted.");
    } else {
      console.error("Bot: Failed to craft crafting table.");
    }
  }

  return hasCraftingTable;
};

// Helper function to ensure a specific amount of planks
export const ensurePlanks = async (neededAmount: number): Promise<boolean> => {
  console.log("Bot: Checking for planks...");

  let planksCount = getItemCount("planks");

  if (neededAmount < planksCount) {
    console.log("Bot: Have enough planks.");
    return true;
  }

  let attempt = 0;
  while (neededAmount > planksCount) {
    if (shouldGiveUp(++attempt, "planks")) return false;
    const logsNeeded = Math.ceil((neededAmount - planksCount) / PLANKS_PER_LOG);

    // Get all available log types in inventory
    const availableLogs = bot.inventory
      .items()
      .filter((item) => item.name.includes("log"));

    // If no logs available, gather more wood
    if (availableLogs.length === 0) {
      const gathered = await gatherWood(logsNeeded, 80);
      if (!gathered) {
        // Avoid looping forever when no trees can be found or the command was cancelled
        console.error("Bot: Not enough logs for planks and couldn't gather more.");
        return false;
      }
      continue;
    }

    // Iterate over each log type to craft planks
    for (const log of availableLogs) {
      const logType = log.name.replace("_log", ""); // Get log type without "_log" suffix
      const logsToCraft = Math.min(log.count, logsNeeded);

      console.log(
        `Trying to make ${logsToCraft * PLANKS_PER_LOG} ${logType}_planks`
      );
      console.log(`NeededAmount: ${neededAmount}, while I have ${planksCount}`);

      const crafted = await craftRecipe(
        `${logType}_planks`,
        logsToCraft * PLANKS_PER_LOG
      );
      if (crafted) {
        planksCount = getItemCount("planks");
        bot.chat(
          `I have crafted ${logsToCraft * PLANKS_PER_LOG} ${logType} planks.`
        );
        console.log(`Bot: ${logType} planks crafted.`);
      } else {
        console.error(`Bot: Failed to craft ${logType} planks.`);
        return false;
      }

      // Check if we have enough planks after crafting
      if (planksCount >= neededAmount) break;
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

  let attempt = 0;
  while (neededAmount > sticksCount) {
    if (shouldGiveUp(++attempt, "sticks")) return false;
    const planksCount = getItemCount("planks");
    const planksNeeded = Math.max(
      Math.ceil((neededAmount - sticksCount) / STICKS_PER_PLANK),
      4
    );

    if (planksCount >= planksNeeded) {
      try {
        const sticksId = getItemId("stick");
        if (sticksId === null) throw new Error("stick is not a known item");
        const recipe = bot.recipesFor(sticksId, null, 1, null)[0];
        if (!recipe) throw new Error("no stick recipe available from current inventory");
        // craft count = recipe runs (each yields recipe.result.count sticks)
        const times = Math.ceil((neededAmount - sticksCount) / (recipe.result?.count ?? 4));
        await bot.craft(recipe, times);
        sticksCount = getItemCount("stick");
        bot.chat(`I have made ${Math.abs(neededAmount - sticksCount)} sticks.`);
        console.log(`Bot: Sticks crafted.`);
      } catch (err) {
        console.error("Bot: Failed to craft sticks.");
        return false;
      }
    } else {
      console.error("Bot: Not enough planks for sticks.");
      if (!(await ensurePlanks(planksNeeded))) return false;
    }
  }

  return sticksCount >= neededAmount;
};

// Ensure a specific number of chests
export const ensureChests = async (quantity: number = 1): Promise<boolean> => {
  console.log(`Bot: Checking for ${quantity} chest(s)...`);

  // Count the number of chests the bot already has
  let chestCount = getItemCount("chest");

  if (chestCount >= quantity) {
    console.log(`Bot: Already has ${quantity} or more chest(s).`);
    return true;
  }

  let attempt = 0;
  while (chestCount < quantity) {
    if (shouldGiveUp(++attempt, "chests")) return false;
    const planksEnsured = await ensurePlanks(8 * quantity); // 8 planks per chest
    if (!planksEnsured) {
      console.error("Bot: Failed to ensure planks for chest(s).");
      return false;
    }

    // Craft the chest(s)
    const crafted = await craftRecipe("chest", quantity - chestCount);
    if (crafted) {
      chestCount = getItemCount("chest");
      bot.chat(`I have crafted ${quantity} chest(s).`);
      console.log(`Bot: ${quantity} chest(s) crafted.`);
      continue;
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
  let furnaceCount = getItemCount("furnace");

  if (furnaceCount >= quantity) {
    console.log(`Bot: Already has ${quantity} or more furnace(s).`);
    return true;
  }

  let attempt = 0;
  while (furnaceCount < quantity) {
    if (shouldGiveUp(++attempt, "furnaces")) return false;
    const stoneEnsured = await ensureCobblestone(8 * (quantity - furnaceCount)); // 8 stone blocks per furnace
    if (!stoneEnsured) {
      console.error("Bot: Failed to ensure stone for furnace(s).");
      return false;
    }

    // Craft the furnace(s)
    const crafted = await craftRecipe("furnace", quantity - furnaceCount);
    if (crafted) {
      furnaceCount = getItemCount("furnace");
      bot.chat(`I have crafted ${quantity} furnace(s).`);
      console.log(`Bot: ${quantity} furnace(s) crafted.`);
      continue;
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
  let torchCount = getItemCount("torch");

  if (torchCount >= quantity) {
    console.log(`Bot: Already has ${quantity} or more torch(es).`);
    return true;
  }

  let attempt = 0;
  while (torchCount < quantity) {
    if (shouldGiveUp(++attempt, "torches")) return false;
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
      torchCount = getItemCount("torch");
      bot.chat(`I have crafted ${quantity} torch(es).`);
      console.log(`Bot: ${quantity} torch(es) crafted.`);
      continue;
    } else {
      console.error("Bot: Failed to craft torch(es).");
    }
  }
  return torchCount >= quantity;
};

// Ensure a campfire
// Todo: rework
export const ensureCampfire = async (): Promise<boolean> => {
  console.log("Bot: Checking for a campfire...");

  let hasCampfire = getItemCount("campfire") > 0;

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

  let attempt = 0;
  while (cobblestoneCount < requiredCobblestone) {
    if (shouldGiveUp(++attempt, "cobblestone")) return false;
    console.log("Bot: Gathering more cobblestone...");
    const cobblestoneShortage = requiredCobblestone - cobblestoneCount;

    try {
      const success = await collectBlock(
        "stone",
        cobblestoneShortage,
        maxDistance
      );
      if (!success) {
        await moveAway(30);
        continue;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("right tools")) {
        if (!(await ensurePickaxe())) return false;
        continue;
      } else {
        console.error("Error collecting cobblestone:", err);
        await moveAway(30);
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

  let attempt = 0;
  while (coalCount < neededAmount) {
    if (shouldGiveUp(++attempt, "coal")) return false;
    console.log("Bot: Gathering more coal...");
    const coalShortage = neededAmount - coalCount;

    try {
      const success = await collectBlock("coal_ore", coalShortage, maxDistance);
      if (!success) {
        await moveAway(30);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("right tools")) {
        if (!(await ensurePickaxe())) return false;
        continue;
      } else {
        console.error("Error collecting coal:", err);
        await moveAway(30);
        continue;
      }
    }

    coalCount = getItemCount("coal");
  }

  console.log("Bot: Collected enough coal.");
  return true;
};
