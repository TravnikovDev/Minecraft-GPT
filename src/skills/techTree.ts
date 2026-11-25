// Path: src/skills/techTree.ts
// Minecraft's progression tree, as data the planner (skills/acquire) reads.
// Crafting itself is never locked: mineflayer puts the items in the grid by
// hand, so recipe-book unlocks don't matter (unless a server turns on the
// doLimitedCrafting gamerule). What does gate progress is materials and tools:
// - Ores need a pickaxe of the right tier (coal: wood, iron and copper:
//   stone, diamond, gold and redstone: iron, obsidian: diamond). Read from the
//   game's own harvest data, so it stays right for the connected version.
// - Some materials only come out of a furnace: charcoal (from logs, when there
//   is no coal around), ingots (from raw ore), glass (from sand), stone.
// So a torch from nothing is: logs -> table -> wooden pickaxe -> cobblestone
// -> furnace -> charcoal (or coal ore, if it finds some) -> torch.

import type { Catalog } from "../core/catalog";

/** What a furnace makes, and from what ("logs" is any log). */
export const SMELTING: Record<string, string> = {
  charcoal: "logs",
  iron_ingot: "raw_iron",
  gold_ingot: "raw_gold",
  copper_ingot: "raw_copper",
  glass: "sand",
  stone: "cobblestone",
  smooth_stone: "stone",
  brick: "clay_ball",
};

/** Materials one can stand in for another in recipes (charcoal works wherever coal does). */
export const STANDS_IN_FOR: Record<string, string> = { charcoal: "coal" };

const PICKAXES = ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "diamond_pickaxe"];

/**
 * The weakest pickaxe that mines an ore dropping `item` ("raw_iron" ->
 * "stone_pickaxe"); null when no ore drops it, or the hand will do.
 */
export function pickaxeFor(item: string, catalog: Catalog): string | null {
  const ores = catalog.oresFor(item);
  if (ores.length === 0) return null;
  let best: number | null = null;
  for (const ore of ores) {
    if (catalog.canHarvest(ore, null)) return null;
    const tier = PICKAXES.findIndex((p) => catalog.canHarvest(ore, p));
    if (tier >= 0 && (best === null || tier < best)) best = tier;
  }
  return best === null ? null : PICKAXES[best]!;
}

/** What a furnace needs to make `item`, or null when it isn't smelted. */
export function smeltedFrom(item: string): string | null {
  return SMELTING[item] ?? null;
}

const pretty = (name: string): string => name.replace(/_/g, " ");

/**
 * How a material is got, for telling the owner ("iron ingot: smelted from raw
 * iron in a furnace; raw iron needs a stone pickaxe"); null for the plain ones
 * (logs, cobblestone, wool).
 */
export function howToGet(item: string, catalog: Catalog): string | null {
  if (item === "coal") return "coal: mined with a wooden pickaxe, or charcoal made from logs in a furnace";
  const input = smeltedFrom(item);
  if (input) {
    const pickaxe = input === "logs" ? null : pickaxeFor(input, catalog);
    return `${pretty(item)}: smelted from ${pretty(input)} in a furnace${pickaxe ? `; ${pretty(input)} needs a ${pretty(pickaxe)}` : ""}`;
  }
  const pickaxe = pickaxeFor(item, catalog);
  return pickaxe ? `${pretty(item)}: mined with a ${pretty(pickaxe)}` : null;
}
