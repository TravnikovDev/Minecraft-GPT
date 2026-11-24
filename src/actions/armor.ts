// Path: src/actions/armor.ts
// Wearing armor: the armor plugin only puts on armor the bot picks up, so
// crafted armor (or armor it already carried) needs an explicit equip.

import { bot } from "../core/body";

// Inventory window slots worn on the body: head, chest, legs, feet
const ARMOR_SLOTS = [5, 6, 7, 8];

/** True for helmets, chestplates, leggings and boots (not horse armor). */
export const isArmorPiece = (name: string): boolean => /_(helmet|chestplate|leggings|boots)$/.test(name);

/** What the bot is wearing now, head to feet. */
export function wornArmor(): string[] {
  return ARMOR_SLOTS.map((slot) => bot.inventory.slots[slot]?.name).filter((n): n is string => Boolean(n));
}

/** Puts on the best armor the bot carries for each slot. Returns what it wears afterwards. */
export async function wearBestArmor(): Promise<string[]> {
  try {
    if (bot.armorManager) await bot.armorManager.equipAll();
  } catch (error) {
    console.log(`Putting on armor failed: ${(error as Error).message}`);
  }
  return wornArmor();
}

const SLOT_FOR: Record<string, "head" | "torso" | "legs" | "feet"> = {
  helmet: "head",
  chestplate: "torso",
  leggings: "legs",
  boots: "feet",
};

/** Takes off a worn armor piece into the inventory (e.g. to give it away). */
export async function takeOffArmor(name: string): Promise<boolean> {
  const slot = SLOT_FOR[name.slice(name.lastIndexOf("_") + 1)];
  if (!slot || !wornArmor().includes(name)) return false;
  try {
    await bot.unequip(slot);
    return bot.inventory.items().some((i) => i.name === name);
  } catch (error) {
    console.log(`Taking off ${name} failed: ${(error as Error).message}`);
    return false;
  }
}
