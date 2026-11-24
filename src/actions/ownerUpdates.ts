// Path: src/actions/ownerUpdates.ts
// Personal status updates for the owner (whispers) about changes to the bot:
// items it picked up or was given, and armor it put on. Also keeps a weapon
// in hand after pickups, instead of whatever item landed in the hand slot.

import type { Item } from "prismarine-item";
import { bot, listen } from "../core/body";
import { on } from "../core/events";
import { getCurrentCommandName } from "../core/commandContext";
import { ownerDistance, tellOwner } from "../managers/ownerDialog";

const NEARBY_BLOCKS = 32; // only report when the owner is around
const GIFT_BLOCKS = 6; // this close, a pickup is most likely a gift
const PICKUP_BATCH_MS = 1500; // group pickups that arrive together
const ARMOR_SLOTS: Record<number, string> = { 5: "helmet", 6: "chestplate", 7: "leggings", 8: "boots" };

const pretty = (name: string): string => name.replace(/_/g, " ");

/** True for items that belong in the main hand by default. */
function isWeapon(name: string): boolean {
  return name.endsWith("_sword") || name.endsWith("_axe");
}

/** Damage ranking for picking the best weapon. */
function weaponRank(name: string): number {
  const tiers = ["wooden", "golden", "stone", "iron", "diamond", "netherite"];
  const tier = tiers.findIndex((t) => name.startsWith(t));
  return (name.endsWith("_sword") ? 10 : 0) + Math.max(0, tier);
}

/**
 * Puts the best weapon in the main hand when the bot is idle and holding
 * something else (food, blocks). Without a weapon, food goes back to inventory.
 */
export async function keepWeaponInHand(): Promise<void> {
  if (getCurrentCommandName() !== null) return; // never interfere with a running task
  const held = bot.heldItem;
  if (held && isWeapon(held.name)) return;

  const best = bot.inventory
    .items()
    .filter((item) => isWeapon(item.name))
    .sort((a, b) => weaponRank(b.name) - weaponRank(a.name))[0];
  try {
    if (best) {
      await bot.equip(best, "hand");
    } else if (held && bot.registry.foodsByName?.[held.name]) {
      await bot.unequip("hand");
    }
  } catch (error) {
    console.error("Could not switch held item:", error);
  }
}

// Pickup batching lives for the whole process (the bus outlives connections)
const pickups = new Map<string, number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let subscribedToPickups = false;

/** Registers the update listeners: pickups once per process, armor per connection. */
export function registerOwnerUpdates(): void {
  const flushPickups = (): void => {
    flushTimer = null;
    const items = [...pickups.entries()].map(([name, count]) => `${count} ${pretty(name)}`);
    pickups.clear();
    const distance = ownerDistance();
    // While busy with its own task (gathering, mining, hunting) pickups are its
    // own work, not gifts; only report what it receives while idle
    const ownWork = getCurrentCommandName() !== null;
    if (items.length > 0 && !ownWork && distance !== null && distance <= NEARBY_BLOCKS) {
      const thanks = distance <= GIFT_BLOCKS ? ", thanks!" : ".";
      tellOwner(`Got ${items.join(", ")}${thanks}`);
    }
    void keepWeaponInHand();
  };

  if (!subscribedToPickups) {
    subscribedToPickups = true;
    on("item:collected", ({ name, count }) => {
      pickups.set(name, (pickups.get(name) ?? 0) + count);
      if (!flushTimer) flushTimer = setTimeout(flushPickups, PICKUP_BATCH_MS);
    });
  }

  listen(bot.inventory, "updateSlot", (slot: number, oldItem: Item | null, newItem: Item | null) => {
    const piece = ARMOR_SLOTS[slot];
    if (!piece || !newItem || newItem.name === oldItem?.name) return;
    const distance = ownerDistance();
    if (distance !== null && distance <= NEARBY_BLOCKS) {
      tellOwner(`I'm wearing ${pretty(newItem.name)} now.`);
    }
  });
}
