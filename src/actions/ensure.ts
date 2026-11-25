// Path: src/actions/ensure.ts
// "Make sure I have ..." helpers, kept for the code that calls them (building,
// the tool commands, digging out). Each is now one call to the planner
// (skills/acquire), which gets what's missing (trees, stone, a crafting table)
// in a bounded number of rounds: the old ensure -> tools -> crafting ->
// gathering recursion is gone.

import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { describeFailure } from "../core/result";
import { acquire } from "../skills/acquire";
import { liveWorld } from "../skills/world";
import { carried } from "../skills/capabilities";

/** Gets `count` of an item (or "logs") with the planner; true when it has them. */
export async function ensureItem(item: string, count: number): Promise<boolean> {
  const result = await acquire(item, count, liveWorld);
  if (!result.ok) console.log(`Couldn't get ${count} ${item.replace(/_/g, " ")}: ${describeFailure(result)}`);
  return result.ok;
}

export const ensureCraftingTable = (): Promise<boolean> => ensureItem("crafting_table", 1);

/** Planks of the kind its logs make (oak by default). */
export async function ensurePlanks(count: number): Promise<boolean> {
  if (carried("planks") >= count) return true;
  const log = bot.inventory.items().find((i) => catalog().isLog(i.name));
  const planks = (log && catalog().planksFor(log.name)) || "oak_planks";
  return ensureItem(planks, count);
}

export const ensureSticks = (count: number): Promise<boolean> => ensureItem("stick", count);
export const ensureChests = (count = 1): Promise<boolean> => ensureItem("chest", count);
export const ensureFurnaces = (count = 1): Promise<boolean> => ensureItem("furnace", count);
export const ensureTorches = (count = 1): Promise<boolean> => ensureItem("torch", count);
export const ensureCampfire = (): Promise<boolean> => ensureItem("campfire", 1);
export const ensureCobblestone = (count: number): Promise<boolean> => ensureItem("cobblestone", count);
export const ensureCoal = (count: number): Promise<boolean> => ensureItem("coal", count);
