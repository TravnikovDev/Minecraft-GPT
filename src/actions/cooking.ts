// Path: src/actions/cooking.ts
// Cooking raw food: on a lit campfire nearby (no fuel, four items at a time,
// about 30 seconds) or in a furnace or smoker (fuel: coal, charcoal, planks or
// logs). A campfire or furnace the bot carries is put down first.

import type { Block } from "prismarine-block";
import { bot } from "../core/body";
import { equipItem, useBlock } from "../core/primitives";
import { closeWindow, openFurnaceAt, windowStep } from "../core/containers";
import { describeFailure } from "../core/result";
import { isCommandCancelled } from "../core/commandContext";
import { goToPosition } from "./movement";
import { placeItemNear } from "./placement";

/** Raw food -> what it cooks into. */
export const RAW_FOODS: Record<string, string> = {
  beef: "cooked_beef",
  porkchop: "cooked_porkchop",
  chicken: "cooked_chicken",
  mutton: "cooked_mutton",
  rabbit: "cooked_rabbit",
  cod: "cooked_cod",
  salmon: "cooked_salmon",
  potato: "baked_potato",
  kelp: "dried_kelp",
};

const CAMPFIRES = ["campfire", "soul_campfire"];
const OVENS = ["smoker", "furnace"]; // a smoker cooks food twice as fast
const CAMPFIRE_COOK_MS = 31_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const count = (name: string): number =>
  bot.inventory.items().filter((i) => i.name === name).reduce((n, i) => n + i.count, 0);

/** Raw food the bot carries (optionally only one kind). */
export function rawFoodInInventory(only: string | null = null): string[] {
  return [...new Set(bot.inventory.items().map((i) => i.name))].filter(
    (name) => name in RAW_FOODS && (!only || name === only)
  );
}

function nearest(names: string[], maxDistance = 24, test: (b: Block) => boolean = () => true): Block | null {
  const ids = names.map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  return (
    bot
      .findBlocks({ matching: ids, maxDistance, count: 16 })
      .map((p) => bot.blockAt(p))
      .filter((b): b is Block => b !== null && test(b))
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] ?? null
  );
}

const isLit = (b: Block): boolean => b.getProperties()["lit"] !== false;

async function walkTo(block: Block): Promise<boolean> {
  if (bot.entity.position.distanceTo(block.position) <= 3.5) return true;
  return goToPosition(block.position.x, block.position.y, block.position.z, 2);
}

/** Puts a campfire or oven the bot carries on the ground. */
async function placeCarried(names: string[]): Promise<Block | null> {
  const item = bot.inventory.items().find((i) => names.includes(i.name));
  return item ? placeItemNear(item.name) : null;
}

/** All lit campfires nearby, nearest first. */
function litCampfires(maxDistance = 24): Block[] {
  const ids = CAMPFIRES.map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  return bot
    .findBlocks({ matching: ids, maxDistance, count: 16 })
    .map((p) => bot.blockAt(p))
    .filter((b): b is Block => b !== null && isLit(b))
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
}

/** Puts up to four raw items on a campfire (one per click). Returns how many it took. */
async function loadCampfire(campfire: Block, foods: string[], max: number): Promise<number> {
  if (!(await walkTo(campfire))) return 0;
  let placed = 0;
  while (placed < Math.min(4, max)) {
    const food = foods.find((f) => count(f) > 0);
    if (!food) break;
    const before = count(food);
    const held = await equipItem(food, "hand");
    const used = held.ok ? await useBlock(campfire) : held;
    if (!used.ok) {
      console.log(`Cooking: couldn't put ${food} on the campfire: ${describeFailure(used)}`);
      break;
    }
    await sleep(300);
    if (count(food) >= before) break; // the campfire is full
    placed++;
  }
  return placed;
}

/**
 * Cooked food pops out on top of the campfire, out of reach from where the
 * bot stood to load it: step right next to it and walk up to each item.
 */
async function collectAround(campfire: Block): Promise<void> {
  const c = campfire.position;
  await goToPosition(c.x, c.y, c.z, 1);
  await sleep(400);
  for (let attempt = 0; attempt < 4; attempt++) {
    const item = bot.nearestEntity(
      (e) => e.name === "item" && e.position.distanceTo(c.offset(0.5, 0.5, 0.5)) < 2.5
    );
    if (!item) return;
    await goToPosition(item.position.x, item.position.y, item.position.z, 1);
    await sleep(400);
  }
}

/**
 * Cooks on every lit campfire nearby at once: loads four items on each,
 * waits the ~30 seconds once, collects from all, and repeats.
 */
async function cookOnCampfires(campfires: Block[], foods: string[], limit: number): Promise<number> {
  const cookedNames = [...new Set(foods.map((f) => RAW_FOODS[f]!))];
  const cookedCount = (): number => cookedNames.reduce((n, name) => n + count(name), 0);
  const startCooked = cookedCount();
  let loaded = 0;

  while (loaded < limit && !isCommandCancelled() && foods.some((f) => count(f) > 0)) {
    const used: Block[] = [];
    let lastLoadAt = 0;
    for (const campfire of campfires) {
      if (loaded >= limit || isCommandCancelled()) break;
      const placed = await loadCampfire(campfire, foods, limit - loaded);
      if (placed > 0) {
        used.push(campfire);
        loaded += placed;
        lastLoadAt = Date.now();
      }
    }
    if (used.length === 0) {
      console.log("Cooking: the campfires took nothing (full or not lit).");
      break;
    }
    console.log(`Cooking: ${loaded} items loaded on ${used.length} campfire(s).`);
    await sleep(Math.max(0, lastLoadAt + CAMPFIRE_COOK_MS - Date.now()));
    for (const campfire of used) await collectAround(campfire);
  }
  const cooked = cookedCount() - startCooked;
  console.log(`Cooking: collected ${cooked} of ${loaded} cooked items.`);
  return cooked;
}

/**
 * Fuel to put in for `items` cooks: coal/charcoal (8 each), else planks or
 * logs (1.5 each); never `input` itself (logs being made into charcoal).
 */
/** True when it carries something to burn (coal, charcoal, planks or logs). */
export const carriesFuel = (): boolean => pickFuel(1) !== null;

function pickFuel(items: number, input: string | null = null): { name: string; amount: number } | null {
  for (const [match, perFuel] of [[/^(coal|charcoal)$/, 8], [/_planks$/, 1.5], [/_log$/, 1.5]] as const) {
    const fuel = bot.inventory.items().find((i) => match.test(i.name) && i.name !== input);
    if (fuel) return { name: fuel.name, amount: Math.min(count(fuel.name), Math.ceil(items / perFuel)) };
  }
  return null;
}

/** Cooks in a furnace or smoker, taking the food out as it's done. */
async function cookInOven(oven: Block, foods: string[], limit: number): Promise<number> {
  if (!(await walkTo(oven))) return 0;
  const opened = await openFurnaceAt(oven);
  if (!opened.ok) {
    console.log(`Cooking: couldn't open the ${oven.name}: ${describeFailure(opened)}`);
    return 0;
  }
  const window = opened.value;
  let cooked = 0;
  try {
    for (const food of foods) {
      if (cooked >= limit || isCommandCancelled()) break;
      const n = Math.min(count(food), limit - cooked, 64);
      if (n === 0) continue;
      if (!window.fuelItem()) {
        const fuel = pickFuel(n, food);
        if (!fuel) {
          console.log("Cooking: no fuel (coal, charcoal, planks or logs).");
          break;
        }
        const fueled = await windowStep("fuelling", () => window.putFuel(bot.registry.itemsByName[fuel.name]!.id, null, fuel.amount));
        if (!fueled.ok) {
          console.log(`Cooking: couldn't add fuel: ${describeFailure(fueled)}`);
          break;
        }
      }
      const loaded = await windowStep(`putting ${food} in`, () => window.putInput(bot.registry.itemsByName[food]!.id, null, n));
      if (!loaded.ok) {
        console.log(`Cooking: couldn't put ${food} in: ${describeFailure(loaded)}`);
        break;
      }
      // Take the cooked food out as it comes; stop when nothing comes for a while
      let idle = 0;
      let done = 0;
      while (done < n && idle < 3 && !isCommandCancelled()) {
        await sleep(oven.name === "smoker" ? 5000 : 10_000);
        const output = window.outputItem();
        if (output && (await windowStep("taking the food out", () => window.takeOutput())).ok) {
          done += output.count;
          idle = 0;
        } else {
          idle++;
        }
      }
      if (window.inputItem()) await windowStep("taking leftovers back", () => window.takeInput()); // leftovers back
      cooked += done;
    }
  } finally {
    closeWindow(window);
  }
  return cooked;
}

/**
 * Cooks the raw food the bot carries (or only `only`), up to `limit` items.
 * Prefers a lit campfire, then a smoker or furnace, placing one it carries.
 * Returns how many items it cooked, or null when it had nowhere to cook.
 */
export async function cookFood(only: string | null = null, limit = 64): Promise<number | null> {
  const foods = rawFoodInInventory(only);
  if (foods.length === 0) return 0;

  let campfires = litCampfires();
  if (campfires.length === 0) {
    const placed = await placeCarried(CAMPFIRES);
    if (placed && isLit(placed)) campfires = [placed];
  }
  if (campfires.length > 0) return cookOnCampfires(campfires, foods, limit);

  const oven = nearest(OVENS) ?? (await placeCarried(OVENS));
  if (oven && pickFuel(1)) return cookInOven(oven, foods, limit);
  return null;
}

/**
 * Smelts up to `n` of `input` in a furnace (one within 24 blocks, or one it
 * carries, put down): logs into charcoal, raw iron into ingots, sand into
 * glass. Returns how many came out, or null with no furnace or no fuel.
 */
export async function smelt(input: string, n: number): Promise<number | null> {
  const furnace = nearest(["furnace"]) ?? (await placeCarried(["furnace"]));
  if (!furnace || !pickFuel(1, input)) return null;
  return cookInOven(furnace, [input], n);
}

/** True when there's somewhere to cook: a lit campfire, a furnace or smoker, or one carried. */
export const hasCookingSpot = (): boolean =>
  nearest(CAMPFIRES, 24, isLit) !== null ||
  nearest(OVENS) !== null ||
  bot.inventory.items().some((i) => [...CAMPFIRES, ...OVENS].includes(i.name));
