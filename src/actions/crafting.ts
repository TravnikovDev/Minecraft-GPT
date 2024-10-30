// src/agent/library/skills/crafting.ts

import * as gameData from "../utils/minecraftData";
import { Item } from "prismarine-item";
import { Block } from "prismarine-block";
import { Recipe } from "prismarine-recipe";
import { placeBlock } from "./worldInteraction";
import { goToNearestBlock, goToPosition, moveAway } from "./movement";
import { bot } from "..";
import { collectBlock } from "./collectBlock";
import { ensureCraftingTable } from "./ensure";
import {
  getInventoryCounts,
  getNearestBlock,
  getNearestFreeSpace,
} from "./world";

/*
Possible Scenarios:

1. **Successful Craft Without Crafting Table**: 
   - The bot attempts to craft the item without a crafting table and succeeds. The function returns `true`.

2. **Crafting Table Nearby**:
   - The bot tries to craft without a crafting table but fails.
   - The bot then checks for a nearby crafting table.
   - If a crafting table is found, the bot moves to it and successfully crafts the item, returning `true`.

3. **No Crafting Table Nearby, Place Crafting Table**:
   - The bot fails to craft without a crafting table and does not find a nearby crafting table.
   - The bot checks inventory for a crafting table, places it at a suitable location, and attempts crafting again.
   - If successful, the function returns `true`. If the bot cannot find a suitable position or fails to craft, it returns `false`.

4. **Insufficient Resources**:
   - At any point, if the bot does not have the required resources to craft the item, it logs an appropriate message and returns `false`.

5. **No Crafting Table and No Suitable Position**:
   - If the bot does not find a crafting table and cannot find a suitable position to place one, it moves away and returns `false`.

6. **Invalid Item Name**:
   - If the provided item name is invalid, the function logs the error and returns `false`.
*/
export async function craftRecipe(
  incomingItemName: string,
  num = 1
): Promise<boolean> {
  let itemName = incomingItemName.replace(" ", "_").toLowerCase();

  if (itemName.endsWith("plank")) itemName += "s"; // Correct common mistakes

  const itemId = gameData.getItemId(itemName);
  if (itemId === null) {
    console.log(`Invalid item name: ${itemName}`);
    return false;
  }

  // Helper function to attempt crafting
  async function attemptCraft(
    recipes: Recipe[] | null,
    craftingTable: Block | null = null
  ): Promise<boolean> {
    if (recipes && recipes.length > 0) {
      const recipe = recipes[0];
      try {
        await bot.craft(recipe, num, craftingTable ?? undefined);
        console.log(
          `Successfully crafted ${num} ${itemName}${
            craftingTable ? " using crafting table" : ""
          }.`
        );
        return true;
      } catch (err) {
        console.log(`Failed to craft ${itemName}: ${(err as Error).message}`);
        return false;
      }
    }
    return false;
  }

  // Helper function to move to a crafting table and attempt crafting with retry logic
  async function moveToAndCraft(craftingTable: Block): Promise<boolean> {
    console.log(`Crafting table found, moving to it.`);
    let maxRetries = 2;
    let attempts = 0;
    let success = false;

    while (attempts < maxRetries && !success) {
      try {
        await goToPosition(
          craftingTable.position.x,
          craftingTable.position.y,
          craftingTable.position.z,
          1
        );
        const recipes = bot.recipesFor(itemId, null, 1, craftingTable);
        success = await attemptCraft(recipes, craftingTable);
      } catch (err) {
        console.log(
          `Attempt ${attempts + 1} to move to crafting table failed: ${
            (err as Error).message
          }`
        );
      }
      attempts++;
    }

    return success;
  }

  // Helper function to find and use or place a crafting table
  async function findAndUseCraftingTable(
    craftingTableRange: number
  ): Promise<boolean> {
    let craftingTable = getNearestBlock("crafting_table", craftingTableRange);
    if (craftingTable) {
      return await moveToAndCraft(craftingTable);
    }

    console.log(`No crafting table nearby, attempting to place one.`);
    const hasCraftingTable = await ensureCraftingTable();
    if (!hasCraftingTable) {
      console.log(`Failed to ensure a crafting table to craft ${itemName}.`);
      return false;
    }

    const pos = getNearestFreeSpace(1, 10);
    if (pos) {
      moveAway(4);
      console.log(
        `Placing crafting table at position (${pos.x}, ${pos.y}, ${pos.z}).`
      );
      await placeBlock("crafting_table", pos.x, pos.y, pos.z);
      craftingTable = getNearestBlock("crafting_table", craftingTableRange);
      if (craftingTable) {
        return await moveToAndCraft(craftingTable);
      }
    } else {
      console.log("No suitable position found to place the crafting table.");
      moveAway(5);
      return false;
    }

    return false;
  }

  // Step 1: Try to craft without a crafting table
  console.log(`Step 1: Try to craft without a crafting table`);
  let recipes = bot.recipesFor(itemId, null, 1, null);
  if (recipes && (await attemptCraft(recipes))) {
    return true;
  }

  // Step 2: Find and use a crafting table
  console.log(`Step 2: Find and use a crafting table`);
  const craftingTableRange = 32;
  if (await findAndUseCraftingTable(craftingTableRange)) {
    return true;
  }

  return false;
}

export async function smeltItem(itemName: string, num = 1): Promise<boolean> {
  const foods = [
    "beef",
    "chicken",
    "cod",
    "mutton",
    "porkchop",
    "rabbit",
    "salmon",
    "tropical_fish",
  ];
  if (!itemName.includes("raw") && !foods.includes(itemName)) {
    console.log(
      `Cannot smelt ${itemName}, must be a "raw" item, like "raw_iron".`
    );
    return false;
  } // TODO: allow cobblestone, sand, clay, etc.

  let placedFurnace = false;
  let furnaceBlock = getNearestBlock("furnace", 32);
  if (!furnaceBlock) {
    // Try to place furnace
    const hasFurnace = getInventoryCounts()["furnace"] > 0;
    if (hasFurnace) {
      const pos = getNearestFreeSpace(1, 32);
      if (pos) {
        await placeBlock("furnace", pos.x, pos.y, pos.z);
      } else {
        console.log("No suitable position found to place the furnace.");
        return false;
      }
      furnaceBlock = getNearestBlock("furnace", 32);
      placedFurnace = true;
    }
  }
  if (!furnaceBlock) {
    console.log(`There is no furnace nearby and I have no furnace.`);
    return false;
  }
  if (bot.entity.position.distanceTo(furnaceBlock.position) > 4) {
    await goToNearestBlock("furnace", 4, 32);
  }
  await bot.lookAt(furnaceBlock.position);

  console.log("smelting...");
  const furnace = await bot.openFurnace(furnaceBlock);
  // Check if the furnace is already smelting something
  const inputItem = furnace.inputItem();
  if (
    inputItem &&
    inputItem.type !== gameData.getItemId(itemName) &&
    inputItem.count > 0
  ) {
    console.log(
      `The furnace is currently smelting ${gameData.getItemName(
        inputItem.type
      )}.`
    );
    if (placedFurnace) await collectBlock("furnace", 1);
    return false;
  }
  // Check if the bot has enough items to smelt
  const invCounts = getInventoryCounts();
  if (!invCounts[itemName] || invCounts[itemName] < num) {
    console.log(`I do not have enough ${itemName} to smelt.`);
    if (placedFurnace) await collectBlock("furnace", 1);
    return false;
  }

  // Fuel the furnace
  if (!furnace.fuelItem()) {
    const fuel = bot.inventory
      .items()
      .find((item) => item.name === "coal" || item.name === "charcoal");
    const putFuel = Math.ceil(num / 8);
    if (!fuel || fuel.count < putFuel) {
      console.log(
        `I do not have enough coal or charcoal to smelt ${num} ${itemName}, I need ${putFuel} coal or charcoal`
      );
      if (placedFurnace) await collectBlock("furnace", 1);
      return false;
    }
    await furnace.putFuel(fuel.type, null, putFuel);
    console.log(
      `Added ${putFuel} ${gameData.getItemName(fuel.type)} to furnace fuel.`
    );
  }
  // Put the items in the furnace
  const itemId = gameData.getItemId(itemName);
  if (itemId === null) {
    console.log(`Invalid item name: ${itemName}`);
    return false;
  }
  await furnace.putInput(itemId, null, num);
  // Wait for the items to smelt
  let total = 0;
  let collectedLast = true;
  let smeltedItem: Item | null = null;
  await new Promise((resolve) => setTimeout(resolve, 200));
  while (total < num) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    console.log("checking...");
    let collected = false;
    if (furnace.outputItem()) {
      smeltedItem = await furnace.takeOutput();
      if (smeltedItem) {
        total += smeltedItem.count;
        collected = true;
      }
    }
    if (!collected && !collectedLast) {
      break; // if nothing was collected this time or last time
    }
    collectedLast = collected;
  }
  await bot.closeWindow(furnace);

  if (placedFurnace) {
    await collectBlock("furnace", 1);
  }
  if (total === 0) {
    console.log(`Failed to smelt ${itemName}.`);
    return false;
  }
  if (total < num) {
    console.log(
      `Only smelted ${total} ${gameData.getItemName(smeltedItem?.type || 0)}.`
    );
    return false;
  }
  console.log(
    `Successfully smelted ${itemName}, got ${total} ${gameData.getItemName(
      smeltedItem?.type || 0
    )}.`
  );
  return true;
}

export async function clearNearestFurnace(): Promise<boolean> {
  const furnaceBlock = getNearestBlock("furnace", 6);
  if (!furnaceBlock) {
    console.log(`There is no furnace nearby.`);
    return false;
  }

  console.log("clearing furnace...");
  const furnace = await bot.openFurnace(furnaceBlock);
  console.log("opened furnace...");
  // Take the items out of the furnace
  let smeltedItem: Item | null = null;
  let inputItem: Item | null = null;
  let fuelItem: Item | null = null;
  if (furnace.outputItem()) smeltedItem = await furnace.takeOutput();
  if (furnace.inputItem()) inputItem = await furnace.takeInput();
  if (furnace.fuelItem()) fuelItem = await furnace.takeFuel();
  console.log(smeltedItem, inputItem, fuelItem);
  const smeltedName = smeltedItem
    ? `${smeltedItem.count} ${smeltedItem.name}`
    : `0 smelted items`;
  const inputName = inputItem
    ? `${inputItem.count} ${inputItem.name}`
    : `0 input items`;
  const fuelName = fuelItem
    ? `${fuelItem.count} ${fuelItem.name}`
    : `0 fuel items`;
  console.log(
    `Cleared furnace, received ${smeltedName}, ${inputName}, and ${fuelName}.`
  );
  await bot.closeWindow(furnace);
  return true;
}
