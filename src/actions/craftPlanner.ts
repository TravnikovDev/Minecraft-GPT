// Path: src/actions/craftPlanner.ts
// Works out how to craft an item from what the bot has: picks the recipe
// variant that fits the inventory (e.g. warped planks for sticks), plans the
// intermediate parts it can make itself (planks from logs, sticks from
// planks), and lists the raw materials it is still missing.

import { bot } from "../core/body";

/** How deep to plan intermediate parts (bed -> planks -> logs is depth 2). */
const MAX_DEPTH = 3;

export interface CraftStep {
  name: string;
  count: number;
}

export interface CraftPlan {
  item: string;
  count: number;
  steps: CraftStep[]; // crafts to run in order, the final item last
  missing: CraftStep[]; // raw materials the bot doesn't have
}

type RecipeLike = {
  result: { id: number; count: number };
  delta: Array<{ id: number; count: number }>;
};

const itemName = (id: number): string => bot.registry.items[id]?.name ?? `item#${id}`;

/** Parts the bot should always make itself from their inputs when missing. */
function alwaysExpand(name: string): boolean {
  return name === "stick" || name.endsWith("_planks") || name === "crafting_table";
}

/** Raw-material groups reported (and gathered) as one thing, e.g. any log. */
export function materialGroup(name: string): string {
  if (name.endsWith("_log") || name.endsWith("_stem")) return "logs";
  if (name.endsWith("_planks")) return "planks";
  return name;
}

function inventoryCounts(): Map<number, number> {
  const counts = new Map<number, number>();
  for (const item of bot.inventory.items()) {
    counts.set(item.type, (counts.get(item.type) ?? 0) + item.count);
  }
  return counts;
}

/** How many ingredients this recipe lacks right now (no sub-crafting). */
function directShortfall(recipe: RecipeLike, wanted: number, inv: Map<number, number>): number {
  const times = Math.ceil(wanted / (recipe.result.count || 1));
  let short = 0;
  for (const d of recipe.delta) {
    if (d.count >= 0) continue;
    short += Math.max(0, -d.count * times - (inv.get(d.id) ?? 0));
  }
  return short;
}

/** Total raw materials still missing if this recipe were used (plans one level down too). */
function simulatedMissing(
  recipe: RecipeLike,
  short: number,
  inv: Map<number, number>,
  depth: number,
  visiting: Set<number>,
  selfId: number
): number {
  const trialInv = new Map(inv);
  const trialMissing = new Map<string, number>();
  const times = Math.ceil(short / (recipe.result.count || 1));
  visiting.add(selfId);
  for (const d of recipe.delta) {
    if (d.count < 0) planInto(d.id, -d.count * times, trialInv, [], trialMissing, depth + 1, visiting);
  }
  visiting.delete(selfId);
  return [...trialMissing.values()].reduce((sum, n) => sum + n, 0);
}

/**
 * Recipes that re-color an item of the same kind (white_dye + black_bed ->
 * white_bed) are never what the owner means by "craft a bed".
 */
function isRecolorRecipe(targetName: string, recipe: RecipeLike): boolean {
  const kind = targetName.includes("_") ? targetName.slice(targetName.lastIndexOf("_")) : null;
  if (!kind) return false;
  return recipe.delta.some((d) => d.count < 0 && itemName(d.id).endsWith(kind));
}

function planInto(
  id: number,
  qty: number,
  inv: Map<number, number>,
  steps: CraftStep[],
  missing: Map<string, number>,
  depth: number,
  visiting: Set<number>
): void {
  const have = inv.get(id) ?? 0;
  if (have >= qty) {
    inv.set(id, have - qty);
    return;
  }
  const short = qty - have;
  inv.set(id, 0);

  const name = itemName(id);
  const recipes: RecipeLike[] =
    depth < MAX_DEPTH && !visiting.has(id)
      ? (bot.recipesAll(id, null, true) as RecipeLike[]).filter((r) => !isRecolorRecipe(name, r))
      : [];
  // Rank by what would really be missing after making parts (so birch logs
  // lead to birch planks), then by what is directly missing
  const ranked = recipes
    .slice(0, 24)
    .map((recipe) => ({
      recipe,
      shortfall: directShortfall(recipe, short, inv),
      deepMissing: depth + 1 < MAX_DEPTH ? simulatedMissing(recipe, short, inv, depth, visiting, id) : 0,
    }))
    .sort((a, b) => a.deepMissing - b.deepMissing || a.shortfall - b.shortfall);
  const best = ranked[0];

  // Craft it ourselves if we have the inputs, or if it's a basic part (sticks,
  // planks, crafting table); otherwise it's a raw material to gather.
  if (!best || (best.shortfall > 0 && !alwaysExpand(name) && depth > 0)) {
    const group = materialGroup(name);
    missing.set(group, (missing.get(group) ?? 0) + short);
    return;
  }

  const perCraft = best.recipe.result.count || 1;
  const times = Math.ceil(short / perCraft);
  visiting.add(id);
  for (const d of best.recipe.delta) {
    if (d.count < 0) planInto(d.id, -d.count * times, inv, steps, missing, depth + 1, visiting);
  }
  visiting.delete(id);
  steps.push({ name, count: times * perCraft });
  inv.set(id, (inv.get(id) ?? 0) + times * perCraft - short);
}

/** Plans crafting `count` of an item (by exact Minecraft ID). */
export function planCraft(item: string, count: number): CraftPlan {
  const id = bot.registry.itemsByName[item]?.id;
  if (id === undefined) return { item, count, steps: [], missing: [{ name: item, count }] };
  const steps: CraftStep[] = [];
  const missing = new Map<string, number>();
  planInto(id, count, inventoryCounts(), steps, missing, 0, new Set());
  return {
    item,
    count,
    steps,
    missing: [...missing.entries()].map(([name, n]) => ({ name, count: n })),
  };
}

/** Craftable variants of a generic name ("helmet" -> iron_helmet, leather_helmet...). */
function genericVariants(singular: string): string[] {
  const items = bot.registry.itemsByName;
  return Object.keys(items).filter(
    (name) =>
      name.endsWith(`_${singular}`) &&
      // "armor" is never horse armor unless the owner says horse
      (!name.includes("horse") || singular.includes("horse")) &&
      bot.recipesAll(items[name]!.id, null, true).length > 0
  );
}

/** The exact item ID for a name, or null when it's generic or unknown. */
function exactItem(requested: string): string | null {
  const items = bot.registry.itemsByName;
  if (items[requested]) return requested;
  const singular = requested.replace(/s$/, "");
  return items[singular] ? singular : null;
}

const missingTotal = (name: string, count: number): number =>
  planCraft(name, count).missing.reduce((sum, m) => sum + m.count, 0);

/**
 * Turns what the owner typed into a real item ID. Generic names pick the
 * variant the bot can make best: "bed" -> white_bed if it has white wool.
 * Returns null when nothing matches.
 */
export function resolveCraftable(requested: string, count: number): string | null {
  const exact = exactItem(requested);
  if (exact) return exact;
  const candidates = genericVariants(requested.replace(/s$/, ""));
  if (candidates.length === 0) return null;

  const preferred = (name: string): number => (/^(white|oak)_/.test(name) ? 0 : 1);
  // Among equally possible tools/armor, the best material wins (stone over wood)
  const TIERS = ["wooden", "golden", "stone", "iron", "diamond", "netherite"];
  const tier = (name: string): number => TIERS.findIndex((t) => name.startsWith(`${t}_`));
  return candidates.sort(
    (a, b) => missingTotal(a, count) - missingTotal(b, count) || tier(b) - tier(a) || preferred(a) - preferred(b)
  )[0]!;
}

/**
 * For a generic name, every variant the bot could craft right now with what
 * it carries ("helmet" with iron and leather -> iron_helmet, leather_helmet).
 * Empty for an exact item ID.
 */
export function readyVariants(requested: string, count: number): string[] {
  if (exactItem(requested)) return [];
  return genericVariants(requested.replace(/s$/, "")).filter((name) => missingTotal(name, count) === 0);
}

/**
 * Crafts an item right away when everything is available (making parts like
 * planks and sticks first). Returns the missing materials instead of asking.
 */
export async function craftNow(item: string, count = 1): Promise<{ ok: boolean; missing: CraftStep[] }> {
  const { craftRecipe } = await import("./crafting");
  const plan = planCraft(item, count);
  if (plan.missing.length > 0) return { ok: false, missing: plan.missing };
  for (const step of plan.steps) {
    if (!(await craftRecipe(step.name, step.count))) return { ok: false, missing: [] };
  }
  return { ok: true, missing: [] };
}
