// Path: src/actions/overflow.ts
// A full inventory, handled like a player: put the cheapest few stacks (about
// a tenth of the inventory) in a chest it knows nearby; with no chest, make
// one (throwing away junk, or setting down a stack of dirt or cobblestone for
// a moment to have room to craft), place it out of the way (in a tunnel, in a
// niche dug into the wall), remember it, and fill it. Then tell the owner.

import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { tellOwner } from "../managers/ownerDialog";
import { chooseChest, describeContents, inventoryFull, itemValue, lookInChest, storeItems, tally } from "./storage";
import { collectDrops, itemsSetDownForLater } from "./pickup";
import { discard, getItemCount } from "./inventory";
import { placeChestOutOfTheWay } from "./placement";

const SLOTS_TO_CRAFT = 2; // planks and the chest each need somewhere to go
const PLANKS_FOR_CHEST = 8;
const RETRY_AFTER_FAIL_MS = 5 * 60_000; // no wood for a chest: don't try again every pickup
let busy = false;
let lastFailedAt = 0;

const free = (): number => bot.inventory.emptySlotCount();

/** Frees slots to craft in: junk is thrown away; failing that, cheap bulk is set down to pick up later. */
async function freeSlotsToCraft(): Promise<boolean> {
  const byValue = [...tally(bot.inventory.items())]
    .filter(([name]) => itemValue(name) <= 1 && !catalog().isLog(name) && !catalog().isPlanks(name))
    .sort((a, b) => itemValue(a[0]) - itemValue(b[0]) || b[1] - a[1]);
  for (const [name] of byValue) {
    if (free() >= SLOTS_TO_CRAFT) break;
    const junk = itemValue(name) === 0;
    // One stack at a time; junk goes for good, bulk comes back into the chest
    const stack = bot.inventory.items().find((i) => i.name === name);
    if (!stack) continue;
    console.log(`${junk ? "Throwing away" : "Setting down for a moment"}: ${stack.count} ${name}.`);
    await discard(name, junk ? -1 : stack.count, { pickUpLater: !junk });
  }
  return free() >= SLOTS_TO_CRAFT;
}

/** 8 planks of one kind (the chest recipe wants matching planks), from logs if needed. */
async function planksForChest(): Promise<boolean> {
  const { craftRecipe } = await import("./crafting");
  const planks = [...tally(bot.inventory.items().filter((i) => catalog().isPlanks(i.name)))].sort((a, b) => b[1] - a[1]);
  if ((planks[0]?.[1] ?? 0) >= PLANKS_FOR_CHEST) return true;
  const log = bot.inventory.items().find((i) => catalog().isLog(i.name) && catalog().planksFor(i.name));
  const kind = log ? catalog().planksFor(log.name) : null;
  if (!kind) return false;
  await craftRecipe(kind, PLANKS_FOR_CHEST - getItemCount(kind));
  return getItemCount(kind) >= PLANKS_FOR_CHEST;
}

/** Crafts a chest, places it nearby and remembers it. Returns where, or null. */
async function makeChest(): Promise<string | null> {
  const { craftRecipe } = await import("./crafting");
  if (getItemCount("chest") === 0) {
    if (!(await freeSlotsToCraft())) return null;
    if (!(await planksForChest())) return null;
    if (!(await craftRecipe("chest", 1)) || getItemCount("chest") === 0) return null;
  }
  const placed = await placeChestOutOfTheWay();
  if (!placed) return null;
  await lookInChest(placed); // remembered from now on
  const p = placed.position;
  return `${p.x}, ${p.y}, ${p.z}`;
}

/**
 * Makes room when the inventory is full: stores the less valuable stuff in a
 * chest it knows nearby, or makes, places and fills a new chest. `why` is what
 * it was doing (for the message if it can't); `keep` is what that job needs
 * and stays with it (the ore it's mining). Returns true if it made room.
 */
/** True while makeRoom is at work (its own chest crafting must not wait on it). */
export const isMakingRoom = (): boolean => busy;

export async function makeRoom(why: string, keep: string[] = []): Promise<boolean> {
  if (busy || !inventoryFull()) return !inventoryFull();
  if (Date.now() - lastFailedAt < RETRY_AFTER_FAIL_MS) return false;
  busy = true;
  try {
    let made: string | null = null;
    if (!(await chooseChest())) {
      tellOwner("My inventory is full, so I'm making a chest to put things in.");
      made = await makeChest();
      if (!made) {
        lastFailedAt = Date.now();
        // Anything it set down comes back; it was only for crafting
        if (itemsSetDownForLater().length > 0) await collectDrops(8);
        tellOwner(`My inventory is full and I couldn't make a chest (I need 2 logs or 8 planks, and a crafting table), so I can't ${why}. Tell me what to drop.`);
        return false;
      }
    }
    // What it set down to make room goes in the chest (it's the cheap bulk anyway)
    const setDown = [...new Set(itemsSetDownForLater().map((e) => (e as { getDroppedItem?: () => { name: string } | null }).getDroppedItem?.()?.name).filter((n): n is string => Boolean(n)))];
    const first = await storeItems("room", [], keep);
    const stored = first?.stored ?? new Map<string, number>();
    if (setDown.length > 0) {
      await collectDrops(8);
      // Walking over the junk it threw away picks that up again: it goes in too
      const junk = bot.inventory.items().filter((i) => itemValue(i.name) === 0).map((i) => i.name);
      const again = await storeItems("items", [...new Set([...setDown, ...junk])].map((name) => ({ name, count: null })));
      for (const [name, n] of again?.stored ?? []) stored.set(name, (stored.get(name) ?? 0) + n);
    }
    const where = made ? `a new chest at ${made}` : `the chest at ${first?.chestAt}`;
    tellOwner(
      stored.size > 0
        ? `My inventory was full, so I put ${describeContents(stored, 6)} in ${where}.`
        : `My inventory is full of things I keep (tools, food, valuables); tell me what to put away.`
    );
    return !inventoryFull();
  } catch (error) {
    console.log(`Making room failed: ${(error as Error).message}`);
    lastFailedAt = Date.now();
    return false;
  } finally {
    busy = false;
  }
}
