// Path: src/skills/world.ts
// The live game behind acquire (skills/acquire.ts): what it carries, the craft
// planner, crafting, and the sources of raw materials (trees, stone, sheep,
// coal). Kept apart so the planner itself can be tested with a fake world.

import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { fail, ok, type ActionResult } from "../core/result";
import { craftNow, planCraft } from "../actions/craftPlanner";
import { gatherWood } from "../actions/gatherWood";
import { collectBlock } from "../actions/collectBlock";
import type { AcquireWorld, Source } from "./acquire";
import { carried, hasTableAccess, TIER, toolTier } from "./capabilities";

/** True when every recipe for the item needs a crafting table (3x3). */
function needsTable(item: string): boolean {
  const id = bot.registry.itemsByName[item]?.id;
  if (id === undefined) return false;
  const recipes = bot.recipesAll(id, null, true) as { requiresTable?: boolean }[];
  return recipes.length > 0 && recipes.every((r) => r.requiresTable);
}

const got = (before: number, after: number, what: string): ActionResult => (after > before ? ok() : fail("missing_items", `found no ${what}`));

/** Where raw materials come from, in the order they're tried. */
export const SOURCES: Source[] = [
  {
    name: "chopping trees",
    gets: (m) => m === "logs" || catalog().isLog(m),
    run: async (_m, count) => {
      const before = carried("logs");
      await gatherWood(Math.max(count, 2), 64);
      return got(before, carried("logs"), "trees");
    },
  },
  {
    name: "mining stone",
    gets: (m) => m === "cobblestone",
    // A pickaxe first (any: wood mines stone)
    needs: () => (toolTier("pickaxe") >= TIER.wooden ? [] : [{ item: "wooden_pickaxe", count: 1 }]),
    run: async (_m, count) => {
      const before = carried("cobblestone");
      await collectBlock("stone", count, 32);
      return got(before, carried("cobblestone"), "stone");
    },
  },
  {
    name: "hunting sheep",
    gets: (m) => /_wool$/.test(m),
    needs: () => (toolTier("sword") >= TIER.wooden ? [] : [{ item: "wooden_sword", count: 1 }]),
    run: async (m, count) => {
      const before = carried(m);
      // An explicit count: a general hunt leaves two of each kind to breed
      // Loaded when used: the command modules reach back to the registry, which reaches here
      const { execute: hunt } = await import("../commands/Hunting");
      await hunt({ maxDistance: 60, mobType: "sheep", count: Math.max(1, count) });
      const wool = bot.inventory.items().filter((i) => /_wool$/.test(i.name)).reduce((n, i) => n + i.count, 0);
      return wool > 0 || carried(m) > before ? ok() : fail("missing_items", "found no sheep");
    },
  },
  {
    name: "mining coal",
    gets: (m) => m === "coal",
    needs: () => (toolTier("pickaxe") >= TIER.wooden ? [] : [{ item: "wooden_pickaxe", count: 1 }]),
    run: async (_m, count) => {
      const before = carried("coal");
      await collectBlock("coal_ore", count, 48);
      return got(before, carried("coal"), "coal");
    },
  },
];

/** acquire() in the live game. */
export const liveWorld: AcquireWorld = {
  have: (item) => carried(item),
  plan: (item, count) => {
    const plan = planCraft(item, count);
    return { missing: plan.missing, needsTable: plan.steps.some((s) => needsTable(s.name)) };
  },
  craft: async (item, count) => (await craftNow(item, count)).ok,
  tableAccess: () => hasTableAccess(),
  sources: SOURCES,
};
