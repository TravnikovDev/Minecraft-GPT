// Path: src/actions/armor.ts
// Wearing armor: the armor plugin only puts on armor the bot picks up, so
// crafted armor (or armor it already carried) needs an explicit equip.

import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { borrow } from "../core/leases";
import { bodyAtRest } from "../core/plugins";
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
  // In the Nether one gold piece stays on (piglins attack a player without
  // gold): the helmet slot takes gold there, and a worn gold piece stays
  const inNether = String((bot.game as { dimension?: string }).dimension ?? "").replace(/^minecraft:/, "") === "the_nether";
  const wearingGold = (): boolean => (["head", "torso", "legs", "feet"] as const).some((s) => bot.inventory.slots[SLOT_INDEX[s]]?.name.startsWith("golden_"));
  for (const slot of ["head", "torso", "legs", "feet"] as const) {
    const worn = bot.inventory.slots[SLOT_INDEX[slot]];
    if (inNether && worn?.name.startsWith("golden_")) continue;
    const pieces = bot.inventory.items().filter((i) => isArmorPiece(i.name) && EQUIP_SLOT[c.armorSlot(i.name) ?? ""] === slot);
    const gold = inNether && slot === "head" && !wearingGold() ? pieces.find((i) => i.name === "golden_helmet") : undefined;
    if (gold) {
      const result = await equipItem(gold.name, slot);
      if (!result.ok) console.log(`Putting on ${gold.name} failed: ${describeFailure(result)}`);
      continue;
    }
    const best = pieces.sort((a, b) => c.armorTier(b.name) - c.armorTier(a.name))[0];
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
  const after = (await borrow({ name: "wearing armor", bucket: 4 }, ["hands"], wearBestArmor, 5_000, bodyAtRest)) ?? wornArmor();
  if (after.join(",") !== before) console.log(`Put on armor: now wearing ${after.join(", ")}.`);
}
