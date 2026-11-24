// Path: src/actions/placement.ts
// Putting items from the inventory down in the world (beds, chests, tables...).

import type { Block } from "prismarine-block";
import { bot } from "../core/body";
import { placeBlock } from "./worldInteraction";
import { getNearestFreeSpace } from "./world";

/**
 * The inventory item to place for what the owner asked: an exact ID, or a
 * generic name like "bed" -> whichever *_bed the bot carries.
 */
export function findPlaceableItem(requested: string): string | null {
  const items = bot.inventory.items();
  const exact = items.find((i) => i.name === requested);
  if (exact) return exact.name;
  const singular = requested.replace(/s$/, "");
  const variant = items.find((i) => i.name.endsWith(`_${singular}`) || i.name === singular);
  return variant?.name ?? null;
}

/** Beds need two free blocks in a row; everything else one. */
function footprint(itemName: string): number {
  return itemName.endsWith("_bed") ? 2 : 1;
}

/**
 * Places an item on free, solid ground near the bot. Returns the placed block,
 * or null if there was no room or the server refused.
 */
export async function placeItemNear(itemName: string): Promise<Block | null> {
  const size = footprint(itemName);
  for (let attempt = 0; attempt < 3; attempt++) {
    const spot = getNearestFreeSpace(size, 6 + attempt * 4);
    if (!spot) return null;
    // Face along the free area so a bed's head lands inside it too
    await bot.lookAt(spot.offset(size, 0, 0), true);
    const ok = await placeBlock(itemName, spot.x, spot.y, spot.z);
    const placed = bot.blockAt(spot);
    if (ok && placed?.name === itemName) return placed;
    console.log(`Placing ${itemName} at ${spot} failed (attempt ${attempt + 1}).`);
  }
  return null;
}

/** The nearest bed block within range, if any. */
export function findNearestBed(maxDistance = 24): Block | null {
  const bedIds = bot.registry.blocksArray.filter((b) => b.name.endsWith("_bed")).map((b) => b.id);
  return bot.findBlock({ matching: bedIds, maxDistance });
}
