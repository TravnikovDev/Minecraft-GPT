// src/utils/inventory.ts

// src/utils/inventory.ts
import type { Bot } from "mineflayer";
import * as world from "./world.js";
import { goToPosition, goToPlayer } from "./movement"; // Import goToPlayer
import { Item } from "prismarine-item";
import { bot } from "..";
import type { InventoryItemType } from "../schemas/types.js";

/**
 * Equip an item from the bot's inventory.
 * @param itemName The name of the item to equip.
 * @returns Whether the item was successfully equipped.
 */
export async function equip(itemName: string): Promise<boolean> {
  const item = bot.inventory
    .items()
    .find((item) => item.name.includes(itemName));
  if (!item) {
    console.log(`You do not have any ${itemName} to equip.`);
    return false;
  }
  let destination: "hand" | "head" | "torso" | "legs" | "feet" = "hand";
  if (itemName.includes("leggings")) destination = "legs";
  else if (itemName.includes("boots")) destination = "feet";
  else if (itemName.includes("helmet")) destination = "head";
  else if (itemName.includes("chestplate")) destination = "torso";

  await bot.equip(item, destination);
  return true;
}

/**
 * Discard an item from the bot's inventory.
 * @param itemName The name of the item to discard.
 * @param num The number of items to discard. Default is -1 for all.
 * @returns Whether the item was successfully discarded.
 */
export async function discard(itemName: string, num = -1): Promise<boolean> {
  let discarded = 0;
  while (true) {
    const item = bot.inventory
      .items()
      .find((item) => item.name.includes(itemName));
    if (!item) {
      break;
    }
    const toDiscard =
      num === -1 ? item.count : Math.min(num - discarded, item.count);
    await bot.toss(item.type, null, toDiscard);
    discarded += toDiscard;
    if (num !== -1 && discarded >= num) {
      break;
    }
  }
  if (discarded === 0) {
    console.log(`You do not have any ${itemName} to discard.`);
    return false;
  }
  console.log(`Successfully discarded ${discarded} ${itemName}.`);
  return true;
}

export async function putInChest(itemName: string, num = -1): Promise<boolean> {
  const chest = world.getNearestBlock("chest", 32);
  if (!chest) {
    console.log(`Could not find a chest nearby.`);
    return false;
  }
  const item = bot.inventory
    .items()
    .find((item) => item.name.includes(itemName));
  if (!item) {
    console.log(`You do not have any ${itemName} to put in the chest.`);
    return false;
  }
  const toPut = num === -1 ? item.count : Math.min(num, item.count);
  await goToPosition(chest.position.x, chest.position.y, chest.position.z);
  const chestContainer = await bot.openContainer(chest);
  await chestContainer.deposit(item.type, null, toPut);
  await chestContainer.close();
  console.log(`Successfully put ${toPut} ${itemName} in the chest.`);
  return true;
}

export async function takeFromChest(
  itemName: string,
  num = -1
): Promise<boolean> {
  const chest = world.getNearestBlock("chest", 32);
  if (!chest) {
    console.log(`Could not find a chest nearby.`);
    return false;
  }
  await goToPosition(chest.position.x, chest.position.y, chest.position.z);
  const chestContainer = await bot.openContainer(chest);
  const item = chestContainer
    .containerItems()
    .find((item) => item.name.includes(itemName));
  if (!item) {
    console.log(`Could not find any ${itemName} in the chest.`);
    await chestContainer.close();
    return false;
  }
  const toTake = num === -1 ? item.count : Math.min(num, item.count);
  await chestContainer.withdraw(item.type, null, toTake);
  await chestContainer.close();
  console.log(`Successfully took ${toTake} ${itemName} from the chest.`);
  return true;
}

/**
 * View the contents of a chest near the bot.
 * @param bot
 * @returns
 */
export async function viewChest(bot: Bot): Promise<boolean> {
  const chest = world.getNearestBlock("chest", 32);
  if (!chest) {
    console.log(`Could not find a chest nearby.`);
    return false;
  }
  await goToPosition(chest.position.x, chest.position.y, chest.position.z);
  const chestContainer = await bot.openContainer(chest);
  const items = chestContainer.containerItems();
  if (items.length === 0) {
    console.log(`The chest is empty.`);
  } else {
    console.log(`The chest contains:`);
    for (const item of items) {
      console.log(`${item.count} ${item.name}`);
    }
  }
  await chestContainer.close();
  return true;
}

/**
 * Ask to bot to eat a food item from its inventory.
 * @param foodName The name of the food item to eat.
 * @returns
 */
export async function eat(foodName = ""): Promise<boolean> {
  let item: Item | undefined;
  let name: string;
  if (foodName) {
    item = bot.inventory.items().find((item) => item.name.includes(foodName));
    name = foodName;
  } else {
    // @ts-ignore
    item = bot.inventory.items().find((item) => item.foodPoints > 0);
    name = "food";
  }
  if (!item) {
    console.log(`You do not have any ${name} to eat.`);
    return false;
  }
  await bot.equip(item, "hand");
  await bot.consume();
  console.log(`Successfully ate ${item.name}.`);
  return true;
}

/**
 * Give an item to a player.
 * @param itemType The name of the item to give.
 * @param username The username of the player to give the item to.
 * @param num The number of items to give.
 * @returns
 */
export async function giveToPlayer(
  itemType: string,
  username: string,
  num = 1
): Promise<boolean> {
  const player = bot.players[username]?.entity;
  if (!player) {
    console.log(`Could not find a player with username: ${username}.`);
    return false;
  }
  await goToPlayer(username);
  await bot.lookAt(player.position);
  await discard(itemType, num);
  return true;
}

/**
 * List the items in the bot's inventory.
 * @param bot
 * @returns
 */
export async function listInventory(): Promise<InventoryItemType[]> {
  const items = await bot.inventory.items();
  sayItems(items);

  return items.map((item) => ({
    name: item.name,
    count: item.count,
  }));
}

export async function checkForItem(itemName: string): Promise<void> {
  const items = await bot.inventory.items();
  const searchableItems = items.filter((item) => item.name.includes(itemName));
  sayItems(searchableItems);
}

export async function sayItems(items: Array<Item> | null = null) {
  if (!items) {
    items = bot.inventory.items();
    if (bot.registry.isNewerOrEqualTo("1.9") && bot.inventory.slots[45])
      items.push(bot.inventory.slots[45]);
  }
  const output = items.map((item) => `${item.name} x ${item.count}`).join(", ");
  if (output) {
    bot.chat(`My inventory contains: ${output}`);
  } else {
    bot.chat("My inventory is empty.`");
  }
}

/**
 * Find the number of free slots in the bot's inventory.
 * @param bot
 * @returns
 */
export function checkFreeSpace(): number {
  const totalSlots = bot.inventory.slots.length;
  const usedSlots = bot.inventory.items().length;
  const freeSlots = totalSlots - usedSlots;
  console.log(`You have ${freeSlots} free slots in your inventory.`);
  return freeSlots;
}

/**
 * Transfer all items from the bot's inventory to a chest.
 * @param bot
 * @returns
 */
export async function transferAllToChest(): Promise<boolean> {
  const chest = world.getNearestBlock("chest", 32);
  if (!chest) {
    console.log(`Could not find a chest nearby.`);
    return false;
  }
  await goToPosition(chest.position.x, chest.position.y, chest.position.z);
  const chestContainer = await bot.openContainer(chest);

  for (const item of bot.inventory.items()) {
    await chestContainer.deposit(item.type, null, item.count);
    console.log(`Put ${item.count} ${item.name} in the chest.`);
  }
  await chestContainer.close();
  return true;
}

/**
 * Utility function to get item count in inventory
 * @param itemName - The name of the item to count.
 * @returns number
 */
export const getItemCount = (itemName: string): number => {
  return bot.inventory
    .items()
    .filter((item) => item.name.includes(itemName))
    .reduce((acc, item) => acc + item.count, 0);
};

/**
 * Organize the bot's inventory.
 * @param bot
 * @returns
 */
export async function organizeInventory(): Promise<void> {
  const items = bot.inventory.items();
  if (items.length === 0) {
    console.log(`Inventory is empty, nothing to organize.`);
    return;
  }

  for (const item of items) {
    await bot.moveSlotItem(
      item.slot,
      bot.inventory.findInventoryItem(item.type, null, false)?.slot ?? item.slot
    );
  }
  console.log(`Inventory has been organized.`);
}
