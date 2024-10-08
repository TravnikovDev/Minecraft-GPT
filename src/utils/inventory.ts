// src/utils/inventory.ts

import { Bot } from "mineflayer";
import * as world from "./world.js";
import { goToPosition, goToPlayer } from "./movement"; // Import goToPlayer
import { Item } from "prismarine-item";
import { bot } from "..";

export async function equip(itemName: string): Promise<boolean> {
  const item = bot.inventory.items().find((item) => item.name === itemName);
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

export async function discard(itemName: string, num = -1): Promise<boolean> {
  let discarded = 0;
  while (true) {
    const item = bot.inventory.items().find((item) => item.name === itemName);
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
  const chest = world.getNearestBlock(bot, "chest", 32);
  if (!chest) {
    console.log(`Could not find a chest nearby.`);
    return false;
  }
  const item = bot.inventory.items().find((item) => item.name === itemName);
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
  const chest = world.getNearestBlock(bot, "chest", 32);
  if (!chest) {
    console.log(`Could not find a chest nearby.`);
    return false;
  }
  await goToPosition(chest.position.x, chest.position.y, chest.position.z);
  const chestContainer = await bot.openContainer(chest);
  const item = chestContainer
    .containerItems()
    .find((item) => item.name === itemName);
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

export async function viewChest(bot: Bot): Promise<boolean> {
  const chest = world.getNearestBlock(bot, "chest", 32);
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

export async function eat(foodName = ""): Promise<boolean> {
  let item: Item | undefined;
  let name: string;
  if (foodName) {
    item = bot.inventory.items().find((item) => item.name === foodName);
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

export async function giveToPlayer(
  itemType: string,
  username: string,
  num = 1
): Promise<boolean> {
  const player = bot.players[username]?.entity;
  if (!player) {
    console.log(`Could not find ${username}.`);
    return false;
  }
  await goToPlayer(username);
  await bot.lookAt(player.position);
  await discard(itemType, num);
  return true;
}
