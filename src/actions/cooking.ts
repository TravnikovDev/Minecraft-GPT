// Path: src/actions/cooking.ts
// Cooking raw food: on a lit campfire nearby (no fuel, four items at a time,
// about 30 seconds) or in a furnace or smoker (fuel: coal, charcoal, planks or
// logs). A campfire or furnace the bot carries is put down first.
//
// A furnace can be loaded and left (owner, 2026-11-28: "why is it standing by
// the furnace after it put everything in? It should load the furnace, go do
// another action, and check the furnace after that action is finished"):
// the furnaces it left cooking are remembered (leftOvens) and a visit between
// its tasks takes out what's done (collectFromOvens).

import { pickFuel } from "./fuel";
import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
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
  if (!item) return null;
  // A furnace or smoker out of the way (a niche underground), a campfire on open ground
  if (/furnace|smoker/.test(item.name)) {
    const { placeOutOfTheWay } = await import("./placement");
    return placeOutOfTheWay(item.name);
  }
  return placeItemNear(item.name);
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

/** True when it carries something to burn (coal, charcoal, planks or logs). */
export const carriesFuel = (): boolean => pickFuel(1) !== null;

// How long a furnace and a smoker take for an item
const OVEN_ITEM_MS: Record<string, number> = { furnace: 10_000, smoker: 5_000 };
// A furnace it couldn't get to or open is tried again this much later, and forgotten after a few tries
const OVEN_RETRY_MS = 2 * 60_000;
const OVEN_TRIES = 3;
// Food left cooking stops counting as food it has this long after it was done (it's far off)
const OVEN_FORGET_MS = 10 * 60_000;
// How far it walks between tasks to a furnace it left cooking (and not up or down its mine for it)
export const OVEN_VISIT_RANGE = 48;
const OVEN_VISIT_DY = 6;

/** A furnace or smoker it loaded and left: where, what's in it, when it's done. */
export type LeftOven = { x: number; y: number; z: number; oven: string; input: string; count: number; readyAt: number; tries: number };
const leftOvens: LeftOven[] = [];

/** Remembers a furnace it left cooking `count` of `input` (the whole input slot). */
function noteLeft(oven: Block, input: string, count: number): void {
  const p = oven.position;
  const i = leftOvens.findIndex((o) => o.x === p.x && o.y === p.y && o.z === p.z);
  if (i >= 0) leftOvens.splice(i, 1);
  if (count <= 0) return;
  leftOvens.push({ x: p.x, y: p.y, z: p.z, oven: oven.name, input, count, readyAt: Date.now() + count * (OVEN_ITEM_MS[oven.name] ?? 10_000), tries: 0 });
}

/** The furnaces it left cooking (a copy). */
export const ovensLeft = (): LeftOven[] => leftOvens.map((o) => ({ ...o }));

/** Forgets one furnace it left (emptied, gone or out of reach). */
function forgetOven(o: LeftOven): void {
  const i = leftOvens.indexOf(o);
  if (i >= 0) leftOvens.splice(i, 1);
}

/** Forgets every furnace it left (tests, a new world). */
export const forgetOvens = (): void => {
  leftOvens.length = 0;
};

/** True when a furnace it left is done and near enough for a visit between tasks. Pure over its inputs. */
export function ovenDue(o: LeftOven, at: { x: number; y: number; z: number }, now: number): boolean {
  const flat = Math.hypot(o.x - at.x, o.z - at.z);
  return now >= o.readyAt && flat <= OVEN_VISIT_RANGE && Math.abs(o.y - at.y) <= OVEN_VISIT_DY;
}

/** A furnace it left that's done and near: worth a visit now. */
export const ovenToCheck = (): boolean => !!bot.entity && leftOvens.some((o) => ovenDue(o, bot.entity.position, Date.now()));

/** Food points of the raw food it left cooking (what it will have once it's collected). */
export function cookingFoodPoints(): number {
  const foods = (bot.registry?.foodsByName ?? {}) as Record<string, { foodPoints?: number }>;
  // One it hasn't been back to long after it was done no longer counts (it went off elsewhere)
  const now = Date.now();
  return leftOvens.filter((o) => now < o.readyAt + OVEN_FORGET_MS).reduce((n, o) => n + o.count * (foods[RAW_FOODS[o.input] ?? ""]?.foodPoints ?? 0), 0);
}

/**
 * Visits the furnaces it left cooking near it (only the done ones, unless
 * `all`: a starving bot takes whatever is ready already): takes out what's
 * done, adds fuel when it ran out with some still to cook, and forgets a
 * furnace once it's empty. How many items it took out.
 */
export async function collectFromOvens(all = false): Promise<number> {
  let took = 0;
  const due = leftOvens.filter((o) => bot.entity && ovenDue(o, bot.entity.position, all ? Infinity : Date.now()));
  for (const o of due) {
    if (isCommandCancelled()) break;
    const block = bot.blockAt(new Vec3(o.x, o.y, o.z));
    if (!block || !OVENS.includes(block.name)) {
      forgetOven(o);
      continue;
    }
    const later = (): void => {
      o.tries++;
      o.readyAt = Date.now() + OVEN_RETRY_MS;
      if (o.tries >= OVEN_TRIES) forgetOven(o);
    };
    if (!(await walkTo(block))) {
      later();
      continue;
    }
    const opened = await openFurnaceAt(block);
    if (!opened.ok) {
      later();
      continue;
    }
    const window = opened.value;
    try {
      const out = window.outputItem();
      if (out && (await windowStep("taking out what's done", () => window.takeOutput())).ok) took += out.count;
      const input = window.inputItem();
      if (input && !window.fuelItem()) {
        const fuel = pickFuel(input.count, input.name);
        if (fuel) await windowStep("more fuel", () => window.putFuel(bot.registry.itemsByName[fuel.name]!.id, null, fuel.amount));
      }
      // Still cooking: back when the rest is done; empty: forgotten
      if (input) noteLeft(block, input.name, input.count);
      else forgetOven(o);
    } finally {
      closeWindow(window);
    }
  }
  if (took > 0) console.log(`Cooking: took ${took} done items out of the furnace(s) I left cooking.`);
  return took;
}

/**
 * Cooks in a furnace or smoker. Waiting there, it takes the food out as it's
 * done; with `leave`, it puts the food and the fuel for it in and goes
 * (collected between its tasks). A batch of something else found in it
 * (the workshop's) means waiting, so that batch goes back in afterwards.
 */
async function cookInOven(oven: Block, foods: string[], limit: number, leave = false): Promise<number> {
  if (!(await walkTo(oven))) return 0;
  const opened = await openFurnaceAt(oven);
  if (!opened.ok) {
    console.log(`Cooking: couldn't open the ${oven.name}: ${describeFailure(opened)}`);
    return 0;
  }
  const window = opened.value;
  let cooked = 0;
  try {
    // Whatever is still in it from before (done food, a different input)
    // comes out first. Game test: its home furnace held something, so the
    // raw iron "had no room", and it walked off at night to make a furnace
    // in the mine
    if (window.outputItem()) await windowStep("taking out what was done", () => window.takeOutput());
    // (the workshop's batch, raw iron or sand, goes back in once the food is
    // cooked: taken out for good, load-and-leave never finished, review)
    const stale = window.inputItem();
    const putBack = stale && !foods.includes(stale.name) ? { name: stale.name, count: stale.count } : null;
    if (putBack) await windowStep(`taking out the ${putBack.name.replace(/_/g, " ")} left in it`, () => window.takeInput());
    const leaveIt = leave && !putBack;
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
      // Only what fits: the same thing already in it (from before) counts
      const already = window.inputItem();
      const room = already && already.name === food ? Math.max(0, 64 - already.count) : 64;
      const put = Math.min(n, room);
      if (put > 0) {
        const loaded = await windowStep(`putting ${food} in`, () => window.putInput(bot.registry.itemsByName[food]!.id, null, put));
        if (!loaded.ok && !(already && already.name === food)) {
          console.log(`Cooking: couldn't put ${food} in: ${describeFailure(loaded)}`);
          break;
        }
      }
      // Loaded and left: off to its next job, back for it between tasks.
      // One kind at a time (one input slot): the rest waits for the next visit
      if (leaveIt) {
        const inIt = window.inputItem();
        // Fuel for all of it, so it cooks while it's away: the same kind
        // topped up when a little was left in from before
        const inFuel = window.fuelItem();
        const more = inIt && inFuel ? pickFuel(inIt.count, food) : null;
        if (more && inFuel && more.name === inFuel.name && more.amount > inFuel.count) {
          await windowStep("more fuel", () => window.putFuel(bot.registry.itemsByName[more.name]!.id, null, Math.min(more.amount - inFuel.count, 64 - inFuel.count)));
        }
        if (inIt && inIt.name === food) {
          noteLeft(oven, food, inIt.count);
          console.log(`Cooking: left ${inIt.count} ${food.replace(/_/g, " ")} cooking in the ${oven.name}; back for it after my next job.`);
        }
        break;
      }
      // Take the cooked food out as it comes; stop when nothing comes for a while
      let idle = 0;
      let done = 0;
      while (done < n && idle < 3 && !isCommandCancelled()) {
        // Waiting at the furnace on purpose: not "stuck" (game test: nudged
        // every 45 s while smelting smooth stone for its shelter)
        (await import("../managers/stuckWatch")).holdPosition(20_000);
        // Out of fuel with some still to smelt: more in (game test: one plank
        // for 16 logs, a charcoal a round, 40 s each)
        if (!window.fuelItem() && window.inputItem()) {
          const more = pickFuel(n - done, food);
          if (!more) break;
          if (!(await windowStep("more fuel", () => window.putFuel(bot.registry.itemsByName[more.name]!.id, null, more.amount))).ok) break;
        }
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
    // The batch it found in the furnace goes back to smelting
    if (putBack && !window.inputItem()) {
      const id = bot.registry.itemsByName[putBack.name]?.id;
      if (id !== undefined && count(putBack.name) > 0) await windowStep(`putting the ${putBack.name.replace(/_/g, " ")} back in`, () => window.putInput(id, null, Math.min(count(putBack.name), putBack.count)));
    }
  } finally {
    closeWindow(window);
  }
  return cooked;
}

/**
 * Cooks the raw food the bot carries (or only `only`), up to `limit` items.
 * Prefers a lit campfire, then a smoker or furnace, placing one it carries.
 * With `leave`, a furnace is loaded and left (see collectFromOvens).
 * Returns how many items it cooked (0 when left cooking), or null when it
 * had nowhere to cook.
 */
export async function cookFood(only: string | null = null, limit = 64, leave = false): Promise<number | null> {
  const foods = rawFoodInInventory(only);
  if (foods.length === 0) return 0;

  let campfires = litCampfires();
  if (campfires.length === 0) {
    const placed = await placeCarried(CAMPFIRES);
    if (placed && isLit(placed)) campfires = [placed];
  }
  if (campfires.length > 0) return cookOnCampfires(campfires, foods, limit);

  const oven = nearest(OVENS) ?? (await placeCarried(OVENS));
  if (oven && pickFuel(1)) return cookInOven(oven, foods, limit, leave);
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
