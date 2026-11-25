// src/utils/minecraftData.ts

import minecraftData, {
  type Biome,
  type IndexedData,
  type ShapedRecipe,
  type ShapelessRecipe,
} from "minecraft-data";
import prismarineItem from "prismarine-item";
import { Entity } from "prismarine-entity";
import type { Bot } from "mineflayer";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";

/**
 * Game data must match the server's Minecraft version: item/block IDs and
 * recipes differ between versions. mineflayer sets `bot.registry` for the
 * connected server's version once it logs in; before that (or if the bot is
 * not created yet) we fall back to this version.
 */
const FALLBACK_VERSION = "1.21.4";

let fallbackData: IndexedData | null = null;
const itemClassCache = new Map<string, ReturnType<typeof prismarineItem>>();

/** Returns minecraft-data for the connected server's version. */
function gameData(): IndexedData {
  // bot.registry is a prismarine-registry, which extends minecraft-data's IndexedData
  const registry = bot?.registry as unknown as IndexedData | undefined;
  if (registry?.version) return registry;
  fallbackData ??= minecraftData(FALLBACK_VERSION);
  return fallbackData;
}

/** Returns the prismarine-item class for the connected server's version. */
function itemClass(): ReturnType<typeof prismarineItem> {
  const version = gameData().version.minecraftVersion ?? FALLBACK_VERSION;
  let cls = itemClassCache.get(version);
  if (!cls) {
    cls = prismarineItem(version);
    itemClassCache.set(version, cls);
  }
  return cls;
}

// Wood types come from the Catalog now (catalog().woodTypes()): the old fixed
// list missed mangrove, cherry, bamboo, crimson, warped and pale oak.

export const WOOL_COLORS: string[] = [
  "white",
  "orange",
  "magenta",
  "light_blue",
  "yellow",
  "lime",
  "pink",
  "gray",
  "light_gray",
  "cyan",
  "purple",
  "blue",
  "brown",
  "green",
  "red",
  "black",
];

/** True for a baby animal or mob (by the registry's metadata key, not a fixed index). */
export function isBaby(mob: Entity): boolean {
  const keys = bot.registry.entitiesByName[mob.name ?? ""]?.metadataKeys as string[] | undefined;
  const index = keys?.indexOf("baby") ?? -1;
  return index >= 0 && Boolean(mob.metadata?.[index]);
}

/** A grown animal worth hunting (by entity type from the game data). */
export function isHuntable(mob: Entity): boolean {
  if (!mob?.name) return false;
  return catalog().isHuntable(mob.name) && !isBaby(mob);
}

/**
 * Returns the item's numeric id for the connected server's version, or null
 * if the name is unknown. (Unknown used to return 0, which is air.)
 */
export function getItemId(itemName: string): number | null {
  const item = gameData().itemsByName[itemName];
  return item ? item.id : null;
}

export function getItemName(itemId: number): string {
  const item = gameData().items[itemId];
  return item.name || "";
}

/** Returns the block's numeric id, or null if the name is unknown (never 0/air). */
export function getBlockId(blockName: string): number | null {
  const block = gameData().blocksByName?.[blockName];
  return block ? block.id : null;
}

export function getBlockName(blockId: number): string {
  const block = gameData().blocks[blockId];
  return block.name || "";
}

export function getAllItems(ignore: string[] = []): any[] {
  const items: any[] = [];
  for (const itemId in gameData().items) {
    const item = gameData().items[itemId];
    if (!ignore.includes(item.name)) {
      items.push(item);
    }
  }
  return items;
}

export function getAllItemIds(ignore: string[] = []): number[] {
  const items = getAllItems(ignore);
  const itemIds: number[] = [];
  for (const item of items) {
    itemIds.push(item.id);
  }
  return itemIds;
}

export function getAllBlocks(ignore: string[] = []): any[] {
  const blocks: any[] = [];
  for (const blockId in gameData().blocks) {
    const block = gameData().blocks[blockId];
    if (!ignore.includes(block.name)) {
      blocks.push(block);
    }
  }
  return blocks;
}

export function getAllBlockIds(ignore: string[] = []): number[] {
  const blocks = getAllBlocks(ignore);
  const blockIds: number[] = [];
  for (const block of blocks) {
    blockIds.push(block.id);
  }
  return blockIds;
}

export function getAllBiomes(): Record<number, Biome> {
  return gameData().biomes;
}

export function getItemCraftingRecipes(itemName: string): any[] | null {
  const itemId = getItemId(itemName);
  if (!itemId || !gameData().recipes[itemId]) {
    return null;
  }

  const recipes: Record<string, number>[] = [];
  for (const r of gameData().recipes[itemId]) {
    const recipe: Record<string, number> = {};
    let ingredients: number[] = [];

    if (isShapelessRecipe(r)) {
      // Handle shapeless recipe
      ingredients = r.ingredients.map((ing: any) => ing.id);
    } else if (isShapedRecipe(r)) {
      // Handle shaped recipe
      ingredients = r.inShape
        .flat()
        .map((ing: any) => ing?.id)
        .filter(Boolean);
    }

    for (const ingredientId of ingredients) {
      const ingredientName = getItemName(ingredientId);
      if (ingredientName === null) continue;
      if (!recipe[ingredientName]) recipe[ingredientName] = 0;
      recipe[ingredientName]++;
    }

    recipes.push(recipe);
  }

  return recipes;
}

// Type guards
function isShapelessRecipe(recipe: any): recipe is ShapelessRecipe {
  return "ingredients" in recipe;
}

function isShapedRecipe(recipe: any): recipe is ShapedRecipe {
  return "inShape" in recipe;
}

export function getItemSmeltingIngredient(
  itemName: string
): string | undefined {
  return {
    baked_potato: "potato",
    steak: "raw_beef",
    cooked_chicken: "raw_chicken",
    cooked_cod: "raw_cod",
    cooked_mutton: "raw_mutton",
    cooked_porkchop: "raw_porkchop",
    cooked_rabbit: "raw_rabbit",
    cooked_salmon: "raw_salmon",
    dried_kelp: "kelp",
    iron_ingot: "raw_iron",
    gold_ingot: "raw_gold",
    copper_ingot: "raw_copper",
    glass: "sand",
  }[itemName];
}

export function getItemBlockSources(itemName: string): string[] {
  const itemId = getItemId(itemName);
  const sources: string[] = [];
  if (!itemId) return sources;
  for (const block of getAllBlocks()) {
    if (block.drops && block.drops.includes(itemId)) {
      sources.push(block.name);
    }
  }
  return sources;
}

export function getItemAnimalSource(itemName: string): string | undefined {
  return {
    raw_beef: "cow",
    raw_chicken: "chicken",
    raw_cod: "cod",
    raw_mutton: "sheep",
    raw_porkchop: "pig",
    raw_rabbit: "rabbit",
    raw_salmon: "salmon",
    leather: "cow",
    wool: "sheep",
  }[itemName];
}

export function getBlockTool(blockName: string): string | null {
  const block = gameData().blocksByName[blockName];
  if (!block || !block.harvestTools) {
    return null;
  }
  const toolIds = Object.keys(block.harvestTools).map((id) => parseInt(id));
  const toolName = getItemName(toolIds[0]);
  return toolName || null; // Assuming the first tool is the simplest
}

export function makeItem(
  name: string,
  amount = 1
): InstanceType<ReturnType<typeof prismarineItem>> {
  const itemId = getItemId(name);
  if (!itemId) throw new Error(`Item ${name} not found.`);
  const Item = itemClass();
  return new Item(itemId, amount);
}

// Function to get the nearest block of a specific type using Mineflayer
export function getNearestBlock(
  bot: Bot,
  blockType: string,
  maxDistance: number
) {
  const blocks = bot.findBlocks({
    matching: (block) => block.name === blockType,
    maxDistance: maxDistance,
    count: 1,
  });

  if (blocks.length === 0) return null;

  const nearestBlockPosition = blocks[0];
  return bot.blockAt(nearestBlockPosition);
}
