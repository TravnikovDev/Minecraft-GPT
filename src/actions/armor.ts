// Path: src/actions/armor.ts
// Wearing armor: the armor plugin only puts on armor the bot picks up, so
// crafted armor (or armor it already carried) needs an explicit equip.

import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { borrow } from "../core/leases";
import { equipItem, unequipSlot, type EquipSlot } from "../core/primitives";
import { describeFailure } from "../core/result";

// Inventory window slots worn on the body: head, chest, legs, feet
const ARMOR_SLOTS = [5, 6, 7, 8];

/** True for helmets, chestplates, leggings and boots (not horse armor). */
export const isArmorPiece = (name: string): boolean => /_(helmet|chestplate|leggings|boots)$/.test(name);

/** What the bot is wearing now, head to feet. */
export function wornArmor(): string[] {
  return ARMOR_SLOTS.map((slot) => bot.inventory.slots[slot]?.name).filter((n): n is string => Boolean(n));
}

const EQUIP_SLOT: Record<string, EquipSlot> = { head: "head", chest: "torso", torso: "torso", legs: "legs", feet: "feet" };
const SLOT_INDEX: Record<EquipSlot, number> = { head: 5, torso: 6, legs: 7, feet: 8, hand: -1, "off-hand": 45 };

/**
 * Puts on the best armor the bot carries for each slot (better than what it
 * wears). Returns what it wears afterwards. Done by the bot itself, not the
 * armor plugin, so it never grabs the hands in the middle of a task.
 */
export async function wearBestArmor(): Promise<string[]> {
  const c = catalog();
  for (const slot of ["head", "torso", "legs", "feet"] as const) {
    const worn = bot.inventory.slots[SLOT_INDEX[slot]];
    const best = bot.inventory
      .items()
      .filter((i) => isArmorPiece(i.name) && EQUIP_SLOT[c.armorSlot(i.name) ?? ""] === slot)
      .sort((a, b) => c.armorTier(b.name) - c.armorTier(a.name))[0];
    if (!best || (worn && c.armorTier(worn.name) >= c.armorTier(best.name))) continue;
    const result = await equipItem(best.name, slot);
    if (!result.ok) console.log(`Putting on ${best.name} failed: ${describeFailure(result)}`);
  }
  return wornArmor();
}

const SLOT_FOR: Record<string, "head" | "torso" | "legs" | "feet"> = {
  helmet: "head",
  chestplate: "torso",
  leggings: "legs",
  boots: "feet",
};

// After taking armor off to give it away, don't put armor back on for a bit
let noAutoWearUntil = 0;

/** Takes off a worn armor piece into the inventory (e.g. to give it away). */
export async function takeOffArmor(name: string): Promise<boolean> {
  const slot = SLOT_FOR[name.slice(name.lastIndexOf("_") + 1)];
  if (!slot || !wornArmor().includes(name)) return false;
  noAutoWearUntil = Date.now() + 30_000;
  const result = await unequipSlot(slot as EquipSlot);
  if (!result.ok) console.log(`Taking off ${name} failed: ${describeFailure(result)}`);
  return result.ok && bot.inventory.items().some((i) => i.name === name);
}

/**
 * Puts on carried armor that's better than (or fills a slot left empty by)
 * what the bot wears. Runs on a timer: crafted or given armor is never
 * put on by the armor plugin, which only reacts to picking items up.
 */
export async function autoWearArmor(): Promise<void> {
  if (Date.now() < noAutoWearUntil || bot.currentWindow) return;
  if (!bot.inventory.items().some((i) => isArmorPiece(i.name))) return;
  const before = wornArmor().join(",");
  // Between the task's actions, never in the middle of one
  const after = (await borrow({ name: "wearing armor", bucket: 4 }, ["hands"], wearBestArmor, 5_000)) ?? wornArmor();
  if (after.join(",") !== before) console.log(`Put on armor: now wearing ${after.join(", ")}.`);
}
