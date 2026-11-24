// Path: src/actions/cooking.ts
// Cooking raw food: on a lit campfire nearby (no fuel, four items at a time,
// about 30 seconds) or in a furnace or smoker (fuel: coal, charcoal, planks or
// logs). A campfire or furnace the bot carries is put down first.

import type { Block } from "prismarine-block";
import { bot } from "../core/body";
import { isCommandCancelled } from "../core/commandContext";
import { goToPosition } from "./movement";
import { pickupNearbyItems } from "./worldInteraction";
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

/** Cooks on a campfire: up to four items at once, they pop off when done. */
async function cookOnCampfire(campfire: Block, foods: string[], limit: number): Promise<number> {
  let cooked = 0;
  while (cooked < limit && !isCommandCancelled()) {
    const raw = foods.find((f) => count(f) > 0);
    if (!raw) break;
    if (!(await walkTo(campfire))) break;

    // Each click puts one item on a free slot (four slots)
    let placed = 0;
    for (let slot = 0; slot < 4 && cooked + placed < limit; slot++) {
      const food = foods.find((f) => count(f) > 0);
      if (!food) break;
      const before = count(food);
      await bot.equip(bot.inventory.items().find((i) => i.name === food)!, "hand");
      await bot.activateBlock(campfire);
      await sleep(300);
      if (count(food) < before) placed++;
      else break; // the campfire is full
    }
    if (placed === 0) {
      console.log("Cooking: the campfire took nothing (full or not lit).");
      break;
    }
    console.log(`Cooking: ${placed} items on the campfire.`);
    await sleep(CAMPFIRE_COOK_MS);
    await pickupNearbyItems(bot, 4);
    cooked += placed;
  }
  return cooked;
}

/** Fuel to put in for `items` cooks: coal/charcoal (8 each), else planks or logs (1.5 each). */
function pickFuel(items: number): { name: string; amount: number } | null {
  for (const [match, perFuel] of [[/^(coal|charcoal)$/, 8], [/_planks$/, 1.5], [/_log$/, 1.5]] as const) {
    const fuel = bot.inventory.items().find((i) => match.test(i.name));
    if (fuel) return { name: fuel.name, amount: Math.min(count(fuel.name), Math.ceil(items / perFuel)) };
  }
  return null;
}

/** Cooks in a furnace or smoker, taking the food out as it's done. */
async function cookInOven(oven: Block, foods: string[], limit: number): Promise<number> {
  if (!(await walkTo(oven))) return 0;
  const window = await bot.openFurnace(oven);
  let cooked = 0;
  try {
    for (const food of foods) {
      if (cooked >= limit || isCommandCancelled()) break;
      const n = Math.min(count(food), limit - cooked, 64);
      if (n === 0) continue;
      if (!window.fuelItem()) {
        const fuel = pickFuel(n);
        if (!fuel) {
          console.log("Cooking: no fuel (coal, charcoal, planks or logs).");
          break;
        }
        await window.putFuel(bot.registry.itemsByName[fuel.name]!.id, null, fuel.amount);
      }
      await window.putInput(bot.registry.itemsByName[food]!.id, null, n);
      // Take the cooked food out as it comes; stop when nothing comes for a while
      let idle = 0;
      let done = 0;
      while (done < n && idle < 3 && !isCommandCancelled()) {
        await sleep(oven.name === "smoker" ? 5000 : 10_000);
        const output = window.outputItem();
        if (output) {
          await window.takeOutput();
          done += output.count;
          idle = 0;
        } else {
          idle++;
        }
      }
      if (window.inputItem()) await window.takeInput(); // leftovers back
      cooked += done;
    }
  } finally {
    bot.closeWindow(window);
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

  const campfire = nearest(CAMPFIRES, 24, isLit) ?? (await placeCarried(CAMPFIRES));
  if (campfire && isLit(campfire)) return cookOnCampfire(campfire, foods, limit);

  const oven = nearest(OVENS) ?? (await placeCarried(OVENS));
  if (oven && pickFuel(1)) return cookInOven(oven, foods, limit);
  return null;
}

/** True when there's somewhere to cook: a lit campfire, a furnace or smoker, or one carried. */
export const hasCookingSpot = (): boolean =>
  nearest(CAMPFIRES, 24, isLit) !== null ||
  nearest(OVENS) !== null ||
  bot.inventory.items().some((i) => [...CAMPFIRES, ...OVENS].includes(i.name));
