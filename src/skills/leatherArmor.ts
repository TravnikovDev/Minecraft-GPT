// Path: src/skills/leatherArmor.ts
// Leather armour from what the hunts bring in (owner: after hunting, check
// the leather and craft leather armour). For each armour slot it wears
// nothing in, the most protective piece the leather pays for, then worn.
// Anything it wears already is as good or better, so it's never replaced.
// Crafted where a table is close (after a hunt, in the field), or at home.

import { bot } from "../core/body";
import { fail, ok, type ActionResult } from "../core/result";

// Leather each piece takes, most protection first (chestplate 3, leggings 2,
// helmet 1, boots 1)
export const LEATHER_PIECES: { item: string; slot: "head" | "torso" | "legs" | "feet"; leather: number }[] = [
  { item: "leather_chestplate", slot: "torso", leather: 8 },
  { item: "leather_leggings", slot: "legs", leather: 7 },
  { item: "leather_helmet", slot: "head", leather: 5 },
  { item: "leather_boots", slot: "feet", leather: 4 },
];

/**
 * The leather pieces to make: for empty slots (nothing worn and none carried
 * for it), most protective first, as far as the leather goes. Pure.
 */
export function leatherPiecesToMake(leather: number, covered: (slot: string) => boolean): string[] {
  const make: string[] = [];
  let left = leather;
  for (const p of LEATHER_PIECES) {
    if (covered(p.slot) || p.leather > left) continue;
    make.push(p.item);
    left -= p.leather;
  }
  return make;
}

const SLOT_INDEX = { head: 5, torso: 6, legs: 7, feet: 8 } as const;
const ARMOR_SLOT_WORD: Record<string, "head" | "torso" | "legs" | "feet"> = { helmet: "head", chestplate: "torso", leggings: "legs", boots: "feet" };

/** True when the slot has armour on, or it carries a piece for it. */
function covered(slot: string): boolean {
  if (bot.inventory?.slots?.[SLOT_INDEX[slot as keyof typeof SLOT_INDEX]]) return true;
  return bot.inventory.items().some((i) => ARMOR_SLOT_WORD[i.name.slice(i.name.lastIndexOf("_") + 1)] === slot);
}

/**
 * Makes and wears leather armour for its empty slots. With `nearTableOnly`
 * (after a hunt, out in the field) only when a crafting table is within a
 * short walk; otherwise it's left for home.
 */
export async function makeLeatherArmor(nearTableOnly = false): Promise<ActionResult> {
  const leather = (bot.inventory?.items() ?? []).filter((i) => i.name === "leather").reduce((n, i) => n + i.count, 0);
  const make = leatherPiecesToMake(leather, covered);
  if (make.length === 0) return ok();
  if (nearTableOnly) {
    const id = bot.registry.blocksByName["crafting_table"]?.id;
    const near = bot.inventory.items().some((i) => i.name === "crafting_table") || (id !== undefined && bot.findBlock({ matching: id, maxDistance: 24 }) !== null);
    if (!near) {
      console.log(`Leather armour: ${make.join(", ")} to make at home (no table near).`);
      return ok();
    }
  }
  const { acquire } = await import("./acquire");
  const { liveWorld } = await import("./world");
  const made: string[] = [];
  for (const item of make) {
    const got = await acquire(item, 1, liveWorld);
    if (got.ok) made.push(item.replace(/_/g, " "));
  }
  if (made.length === 0) return fail("refused", `I couldn't craft ${make.join(", ").replace(/_/g, " ")}`);
  const { wearBestArmor } = await import("../actions/armor");
  await wearBestArmor();
  const { chatter } = await import("../core/narrator");
  chatter(`Made and put on ${made.join(", ")} from my leather.`, "armor");
  return ok();
}
