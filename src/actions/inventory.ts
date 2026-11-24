// Path: src/actions/inventory.ts
// The bot's own inventory: equipping, discarding, eating, giving, listing and
// counting items. Chests are in actions/storage.ts.
import { goToPlayer } from "./movement";
import { Item } from "prismarine-item";
import { bot } from "../core/body";
import { tossing } from "./pickup";
import { catalog } from "../core/catalog";
import type { InventoryItemType } from "../schemas/types.js";

/**
 * Equip an item from the bot's inventory.
 * @param itemName The name of the item to equip.
 * @returns Whether the item was successfully equipped.
 */
export async function equip(itemName: string): Promise<boolean> {
  const matches = itemMatcher(itemName);
  const item = bot.inventory.items().find((item) => matches(item.name));
  if (!item) {
    console.log(`You do not have any ${itemName} to equip.`);
    return false;
  }
  const destination = catalog().armorSlot(item.name) ?? "hand";

  await bot.equip(item, destination);
  return true;
}

/**
 * Discard an item from the bot's inventory.
 * @param itemName The name of the item to discard.
 * @param num The number of items to discard. Default is -1 for all.
 * @returns Whether the item was successfully discarded.
 */
export async function discard(itemName: string, num = -1, { pickUpLater = false } = {}): Promise<boolean> {
  // Exact name or category: discarding "stone" must never toss a stone pickaxe
  const matches = itemMatcher(itemName);
  let discarded = 0;
  while (true) {
    const item = bot.inventory.items().find((item) => matches(item.name));
    if (!item) {
      break;
    }
    const toDiscard =
      num === -1 ? item.count : Math.min(num - discarded, item.count);
    await tossing(() => bot.toss(item.type, null, toDiscard), { pickUpLater });
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



/**
 * Ask to bot to eat a food item from its inventory.
 * @param foodName The name of the food item to eat.
 * @returns
 */
export async function eat(foodName = ""): Promise<boolean> {
  let item: Item | undefined;
  let name: string;
  if (foodName) {
    const matches = itemMatcher(foodName);
    item = bot.inventory.items().find((item) => matches(item.name) && catalog().isFood(item.name));
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
  // Exact name only: "plate" must never toss the iron chestplate
  let given = 0;
  while (given < num) {
    const item = bot.inventory.items().find((i) => i.name === itemType);
    if (!item) break;
    const n = Math.min(num - given, item.count);
    await tossing(() => bot.toss(item.type, null, n));
    given += n;
  }
  console.log(`Gave ${given} of ${num} ${itemType} to ${username}.`);
  return given > 0;
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
  // "do you have iron?": items whose name has those whole words (raw_iron,
  // iron_ingot, iron_pickaxe), or the category/exact item
  const c = catalog();
  const words = c.normalize(itemName).split("_");
  const matches = itemMatcher(itemName);
  const searchableItems = items.filter(
    (item) => matches(item.name) || words.every((w) => item.name.split("_").includes(w))
  );
  // Also where it put some away, so "do you have iron?" isn't answered "my inventory is empty"
  const { whereStored } = await import("./storage");
  const stored = whereStored(itemName);
  const inChests = stored.length > 0 ? ` I put ${stored.join("; ")}.` : "";
  if (searchableItems.length === 0) {
    bot.chat(`I don't have any ${itemName.replace(/_/g, " ")} on me.${inChests}`);
    return;
  }
  const output = searchableItems.map((item) => `${item.name} x ${item.count}`).join(", ");
  bot.chat(`I have ${output}.${inChests}`);
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
    bot.chat("My inventory is empty.");
  }
}

/**
 * How many of an item the bot carries: an exact name ("stick", "chest"), or a
 * Catalog category ("planks", "logs", "pickaxe", "axe", "food"). Never a
 * substring match: "chest" used to count chestplates, "axe" pickaxes.
 */
export const getItemCount = (itemName: string): number => {
  const matches = itemMatcher(itemName);
  return bot.inventory
    .items()
    .filter((item) => matches(item.name))
    .reduce((acc, item) => acc + item.count, 0);
};

/**
 * What a name means for items the bot carries: the exact item, or a Catalog
 * category ("planks", "logs", "food", "pickaxe", "axe"...). Never a substring.
 */
export function itemMatcher(itemName: string): (name: string) => boolean {
  const c = catalog();
  const name = c.normalize(itemName);
  if (c.isItem(name)) return (item) => item === name;
  if (name === "planks") return (item) => c.isPlanks(item);
  if (name === "logs" || name === "log" || name === "wood") return (item) => c.isLog(item);
  if (name === "food") return (item) => c.isFood(item);
  if (["pickaxe", "axe", "shovel", "hoe", "sword"].includes(name)) return (item) => c.toolKind(item) === name;
  const one = c.validate(name);
  return one.ok ? (item) => item === one.name : () => false; // plural ("torches")
}

