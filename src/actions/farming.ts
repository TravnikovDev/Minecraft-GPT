// Path: src/actions/farming.ts
// Harvesting farms: ripe crops are broken, their drops picked up and the
// farmland replanted with the matching seed, so the farm keeps producing.

import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { isCommandCancelled } from "../core/commandContext";
import { markSelfAction } from "../core/events";
import { goToPosition } from "./movement";
import { pickupNearbyItems } from "./worldInteraction";

type Crop = { ripeAge: number | null; seed: string | null };

// Blocks worth harvesting. ripeAge null: always ripe (melons, pumpkins).
// seed: what to plant back on the farmland afterwards.
const CROPS: Record<string, Crop> = {
  wheat: { ripeAge: 7, seed: "wheat_seeds" },
  carrots: { ripeAge: 7, seed: "carrot" },
  potatoes: { ripeAge: 7, seed: "potato" },
  beetroots: { ripeAge: 3, seed: "beetroot_seeds" },
  melon: { ripeAge: null, seed: null },
  pumpkin: { ripeAge: null, seed: null },
};
const BERRY_BUSH = "sweet_berry_bush";

/** True when a crop block is fully grown. */
function isRipe(block: Block): boolean {
  if (block.name === BERRY_BUSH) return Number(block.getProperties()["age"] ?? 0) >= 2;
  const crop = CROPS[block.name];
  if (!crop) return false;
  if (crop.ripeAge === null) return true;
  return Number(block.getProperties()["age"] ?? 0) >= crop.ripeAge;
}

/** Ripe crops (and berry bushes) nearby, nearest first. `only` limits the kinds. */
export function findRipeCrops(maxDistance = 24, only: string[] | null = null): Block[] {
  const names = [...Object.keys(CROPS), BERRY_BUSH].filter((n) => !only || only.includes(n));
  const ids = names.map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  if (ids.length === 0) return [];
  return bot
    .findBlocks({ matching: ids, maxDistance, count: 512 })
    .map((p) => bot.blockAt(p))
    .filter((b): b is Block => b !== null && isRipe(b))
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
}

/** Plants the crop's seed back on the farmland under a harvested crop. */
async function replant(position: Vec3, seed: string): Promise<void> {
  const farmland = bot.blockAt(position.offset(0, -1, 0));
  const spot = bot.blockAt(position);
  if (farmland?.name !== "farmland" || (spot && spot.name !== "air")) return;
  const item = bot.inventory.items().find((i) => i.name === seed);
  if (!item) return;
  try {
    await bot.equip(item, "hand");
    markSelfAction(position);
    await bot.placeBlock(farmland, new Vec3(0, 1, 0));
  } catch (error) {
    console.log(`Replanting ${seed} at ${position} failed: ${(error as Error).message}`);
  }
}

/** Harvests one ripe crop (or picks a berry bush) and replants it. */
async function harvestOne(block: Block): Promise<boolean> {
  if (bot.entity.position.distanceTo(block.position) > 3.5) {
    if (!(await goToPosition(block.position.x, block.position.y, block.position.z, 2))) return false;
  }
  const current = bot.blockAt(block.position);
  if (!current || !isRipe(current)) return false; // someone else got it
  try {
    if (current.name === BERRY_BUSH) {
      await bot.activateBlock(current); // berries come off, the bush stays
    } else {
      markSelfAction(current.position);
      await bot.dig(current);
      const seed = CROPS[current.name]?.seed;
      if (seed) {
        await new Promise((r) => setTimeout(r, 250)); // drops land first
        await pickupNearbyItems(bot, 2);
        await replant(current.position, seed);
      }
    }
    return true;
  } catch (error) {
    console.log(`Harvesting ${current.name} at ${current.position} failed: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Harvests ripe crops nearby until `enough()` says so or none are left.
 * Returns how many crops it harvested.
 */
export async function harvestCrops(
  options: { maxDistance?: number; only?: string[] | null; enough?: () => boolean } = {}
): Promise<number> {
  const maxDistance = options.maxDistance ?? 24;
  let harvested = 0;
  let failures = 0;
  while (!isCommandCancelled() && failures < 5 && !options.enough?.()) {
    const next = findRipeCrops(maxDistance, options.only ?? null)[0];
    if (!next) break;
    if (await harvestOne(next)) {
      harvested++;
      failures = 0;
    } else {
      failures++;
    }
    if (harvested % 8 === 0) await pickupNearbyItems(bot, 8);
  }
  await pickupNearbyItems(bot, 8);
  return harvested;
}
