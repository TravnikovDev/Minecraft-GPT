// src/agent/library/skills/crafting.ts

import * as gameData from "../utils/minecraftData";
import * as world from "./world.js";
import { Item } from "prismarine-item";
import { collectBlock, placeBlock } from "./worldInteraction";
import { goToNearestBlock } from "./movement";
import { bot } from "..";

export async function craftRecipe(itemName: string, num = 1): Promise<boolean> {
  let placedTable = false;

  if (itemName.endsWith("plank")) itemName += "s"; // Correct common mistakes

  // Get recipes that don't require a crafting table
  const craftingTableRange = 32;
  let craftingTable = world.getNearestBlock(
    bot,
    "crafting_table",
    craftingTableRange
  );
  let recipes = bot.recipesFor(gameData.getItemId(itemName), null, 1, null);
  const pos = world.getNearestFreeSpace(bot, 1, 6);
  const hasTable = world.getInventoryCounts(bot)["crafting_table"] > 0;

  // Look for crafting table
  if (!recipes || recipes.length === 0) {
    if (!craftingTable) {
      if (!hasTable) {
        try {
          const craftingTableRecipe = bot.recipesFor(
            bot.registry.itemsByName["crafting_table"].id,
            null,
            1,
            null
          )[0];
          if (craftingTableRecipe) {
            await bot.craft(craftingTableRecipe, 1);
          }
        } catch (err) {
          console.log(
            `Failed to make and place a crafting table: ${
              (err as Error).message
            }`
          );
          return false;
        }
      }
      console.log("Positioning crafting table...", pos?.x, pos?.y, pos?.z);
      if (pos) {
        await placeBlock("crafting_table", pos.x, pos.y, pos.z);
      } else {
        console.log("No suitable position found to place the crafting table.");
        return false;
      }
      craftingTable = world.getNearestBlock(
        bot,
        "crafting_table",
        craftingTableRange
      );
      placedTable = !!craftingTable;
    }
    if (craftingTable) {
      recipes = bot.recipesFor(
        gameData.getItemId(itemName),
        null,
        1,
        craftingTable
      );
    }
  }

  if (!recipes || recipes.length === 0) {
    console.log(`You do not have the resources to craft a ${itemName}.`);
    if (placedTable) {
      await collectBlock("crafting_table", 1);
    }
    return false;
  }

  if (
    craftingTable &&
    bot.entity.position.distanceTo(craftingTable.position) > 4
  ) {
    await goToNearestBlock("crafting_table", 4, craftingTableRange);
  }

  const recipe = recipes[0];
  console.log("crafting...");
  try {
    await bot.craft(recipe, num, craftingTable);
    const invCounts = world.getInventoryCounts(bot);
    const itegameDataount = invCounts[itemName] || 0;
    console.log(
      `Successfully crafted ${itemName}, you now have ${itegameDataount} ${itemName}.`
    );
    if (placedTable) {
      await collectBlock("crafting_table", 1);
    }
    return true;
  } catch (err) {
    console.log(`Failed to craft ${itemName}: ${(err as Error).message}`);
    if (placedTable) {
      await collectBlock("crafting_table", 1);
    }
    return false;
  }
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
  let furnaceBlock = world.getNearestBlock(bot, "furnace", 32);
  if (!furnaceBlock) {
    // Try to place furnace
    const hasFurnace = world.getInventoryCounts(bot)["furnace"] > 0;
    if (hasFurnace) {
      const pos = world.getNearestFreeSpace(bot, 1, 32);
      if (pos) {
        await placeBlock("furnace", pos.x, pos.y, pos.z);
      } else {
        console.log("No suitable position found to place the furnace.");
        return false;
      }
      furnaceBlock = world.getNearestBlock(bot, "furnace", 32);
      placedFurnace = true;
    }
  }
  if (!furnaceBlock) {
    console.log(`There is no furnace nearby and you have no furnace.`);
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
  const invCounts = world.getInventoryCounts(bot);
  if (!invCounts[itemName] || invCounts[itemName] < num) {
    console.log(`You do not have enough ${itemName} to smelt.`);
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
        `You do not have enough coal or charcoal to smelt ${num} ${itemName}, you need ${putFuel} coal or charcoal`
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
  const furnaceBlock = world.getNearestBlock(bot, "furnace", 6);
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
