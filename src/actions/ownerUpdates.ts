// Path: src/actions/ownerUpdates.ts
// Personal status updates for the owner (whispers) about changes to the bot:
// items it picked up or was given, and armor it put on. Also keeps a weapon
// in hand after pickups, instead of whatever item landed in the hand slot.

import type { Item } from "prismarine-item";
import { catalog } from "../core/catalog";
import { bot, listen } from "../core/body";
import { equipItem, unequipSlot } from "../core/primitives";
import { borrow } from "../core/leases";
import { describeFailure } from "../core/result";
import { on } from "../core/events";
import { getCurrentCommandName } from "../core/commandContext";
import { OWNER_USERNAME } from "../config/env";
import { ownerDistance, tellOwner } from "../managers/ownerDialog";

const NEARBY_BLOCKS = 32; // only report when the owner is around
const PICKUP_BATCH_MS = 1500; // group pickups that arrive together
const ARMOR_SLOTS: Record<number, string> = { 5: "helmet", 6: "chestplate", 7: "leggings", 8: "boots" };

const pretty = (name: string): string => name.replace(/_/g, " ");

/** True for items that belong in the main hand by default. */
function isWeapon(name: string): boolean {
  return catalog().isMeleeWeapon(name);
}

/** Damage ranking for picking the best weapon. */
function weaponRank(name: string): number {
  return (catalog().toolKind(name) === "sword" ? 10 : 0) + Math.max(0, catalog().toolTier(name));
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
    // Between the task's actions, never in the middle of one
    const result = await borrow({ name: "weapon in hand", bucket: 4 }, ["hands"], async () =>
      best ? await equipItem(best.name, "hand") : held && bot.registry.foodsByName?.[held.name] ? await unequipSlot("hand") : null
    , 3_000);
    if (result && !result.ok) console.log(`Could not switch held item: ${describeFailure(result)}`);
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
    // Only what the owner threw to it (see item:collected)
    if (items.length > 0 && distance !== null && distance <= NEARBY_BLOCKS) {
      tellOwner(`Got ${items.join(", ")}, thanks!`);
    }
    void keepWeaponInHand();
  };

  if (!subscribedToPickups) {
    subscribedToPickups = true;
    on("item:collected", ({ name, count, from }) => {
      // Only what the owner threw to it is a gift; drops from mobs, blocks or
      // its own work aren't (they used to be thanked for when the owner stood near)
      if (from === OWNER_USERNAME) pickups.set(name, (pickups.get(name) ?? 0) + count);
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
