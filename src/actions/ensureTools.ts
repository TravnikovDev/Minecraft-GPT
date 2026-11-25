// Path: src/actions/ensureTools.ts
// "Make sure I have a pickaxe/axe/..." for the code that calls it. A tool of
// that kind counts if it's stone or better when `minTier` asks for it (a
// wooden pickaxe never stops it from making a stone one when stone is
// wanted). Made with the planner (skills/acquire): stone when it has the
// cobblestone (or is asked for stone), else wood.

import { catalog } from "../core/catalog";
import { bot } from "../core/body";
import { ensureItem } from "./ensure";
import { carried, TIER } from "../skills/capabilities";

type ToolType = "pickaxe" | "sword" | "axe" | "shovel" | "hoe";

/** Cobblestone (or planks) one tool of that kind takes. */
export const materialsForTool = (tool: ToolType): number => ({ pickaxe: 3, axe: 3, sword: 2, hoe: 2, shovel: 1 })[tool];

/** How many tools of a kind it carries at `minTier` or better. */
function toolsOf(kind: ToolType, minTier: number): number {
  const c = catalog();
  return bot.inventory.items().filter((i) => c.toolKind(i.name) === kind && c.toolTier(i.name) >= minTier).length;
}

/** Has `quantity` tools of the kind (at `minTier` or better), making the rest. */
export async function ensureTool(kind: ToolType, quantity = 1, minTier: number = TIER.wooden): Promise<boolean> {
  while (toolsOf(kind, minTier) < quantity) {
    const stone = minTier >= TIER.stone || carried("cobblestone") >= materialsForTool(kind);
    const item = `${stone ? "stone" : "wooden"}_${kind}`;
    const before = toolsOf(kind, minTier);
    if (!(await ensureItem(item, carried(item) + 1))) return false;
    if (toolsOf(kind, minTier) <= before) return false; // made nothing that counts: don't loop
  }
  return true;
}

export const ensurePickaxe = (quantity = 1): Promise<boolean> => ensureTool("pickaxe", quantity);
export const ensureSword = (quantity = 1): Promise<boolean> => ensureTool("sword", quantity);
export const ensureAxe = (quantity = 1): Promise<boolean> => ensureTool("axe", quantity);
export const ensureShovel = (quantity = 1): Promise<boolean> => ensureTool("shovel", quantity);
export const ensureHoe = (quantity = 1): Promise<boolean> => ensureTool("hoe", quantity);
