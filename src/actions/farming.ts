// Path: src/actions/farming.ts
// Harvesting farms: ripe crops are broken, their drops picked up and the
// farmland replanted with the matching seed, so the farm keeps producing.
// Also tilling ground with a hoe and sowing it (tillAndSow).

import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { forbiddenAt } from "../core/forbidden";
import { breakBlock, equipItem, goTo, knownBlock, placeBlockAt, useBlock, withinReach } from "../core/primitives";
import { describeFailure } from "../core/result";
import { isCommandCancelled } from "../core/commandContext";
import { goToPosition } from "./movement";
import { pickupNearbyItems } from "./pickup";

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

/**
 * Ripe crops (and berry bushes) nearby, nearest first. `only` limits the
 * kinds; `point` searches around a spot (a farmer's field) instead of the
 * bot, so the search doesn't drift off the field as it works.
 */
export function findRipeCrops(maxDistance = 24, only: string[] | null = null, point: Vec3 | null = null): Block[] {
  const names = [...Object.keys(CROPS), BERRY_BUSH].filter((n) => !only || only.includes(n));
  const ids = names.map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  if (ids.length === 0) return [];
  return bot
    .findBlocks({ matching: ids, maxDistance, count: 512, ...(point ? { point } : {}) })
    .map((p) => bot.blockAt(p))
    .filter((b): b is Block => b !== null && isRipe(b) && !forbiddenAt(b.position)) // not in a keep-out area (the owner's farm)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
}

/** Plants the crop's seed back on the farmland under a harvested crop. */
async function replant(position: Vec3, seed: string): Promise<void> {
  const farmland = bot.blockAt(position.offset(0, -1, 0));
  const spot = bot.blockAt(position);
  if (farmland?.name !== "farmland" || (spot && spot.name !== "air")) return;
  const item = bot.inventory.items().find((i) => i.name === seed);
  if (!item) return;
  const planted = await placeBlockAt(item.name, position, { against: new Vec3(0, -1, 0) });
  if (!planted.ok) console.log(`Replanting ${seed} at ${position} failed: ${describeFailure(planted)}`);
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
      const picked = await useBlock(current); // berries come off, the bush stays
      if (!picked.ok) throw new Error(describeFailure(picked));
    } else {
      const broken = await breakBlock(current.position, { allowWithoutHarvest: true });
      if (!broken.ok) throw new Error(describeFailure(broken));
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
  options: { maxDistance?: number; only?: string[] | null; enough?: () => boolean; point?: Vec3 | null } = {}
): Promise<number> {
  const maxDistance = options.maxDistance ?? 24;
  let harvested = 0;
  let failures = 0;
  while (!isCommandCancelled() && failures < 5 && !options.enough?.()) {
    const next = findRipeCrops(maxDistance, options.only ?? null, options.point ?? null)[0];
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

/**
 * Tills grass or dirt at x, y, z with a hoe (checking it turned to farmland)
 * and, with `seedType`, sows on top of it.
 */
export async function tillAndSow(x: number, y: number, z: number, seedType: string | null = null): Promise<boolean> {
  const blockPos = new Vec3(Math.round(x), Math.round(y), Math.round(z));
  const block = knownBlock(blockPos);
  if (!block) {
    console.log(`No block known at ${blockPos} (not loaded).`);
    return false;
  }
  if (block.name !== "grass_block" && block.name !== "dirt" && block.name !== "farmland") {
    console.log(`Cannot till ${block.name}, must be grass_block or dirt.`);
    return false;
  }
  const abovePos = blockPos.offset(0, 1, 0);
  const above = knownBlock(abovePos);
  if (!above || above.name !== "air") {
    console.log(`Cannot till, there is ${above?.name ?? "something unknown"} above the block.`);
    return false;
  }
  if (!withinReach(blockPos)) {
    const walked = await goTo(new pf.goals.GoalNear(blockPos.x, blockPos.y, blockPos.z, 3));
    if (!walked.ok) {
      console.log(`Can't get to the ground to till: ${describeFailure(walked)}`);
      return false;
    }
  }
  if (block.name !== "farmland") {
    const hoe = bot.inventory.items().find((item) => catalog().toolKind(item.name) === "hoe");
    if (!hoe) {
      console.log(`Cannot till, no hoes.`);
      return false;
    }
    const held = await equipItem(hoe.name, "hand");
    const used = held.ok ? await useBlock(block) : held;
    if (!used.ok || !(await settlesTo(blockPos, "farmland"))) {
      console.log(`Tilling at ${blockPos} didn't work${used.ok ? "" : `: ${describeFailure(used)}`}.`);
      return false;
    }
    console.log(`Tilled block at ${blockPos}.`);
  }

  if (seedType) {
    if (seedType.endsWith("seed") && !seedType.endsWith("seeds")) seedType += "s"; // Fixes common mistake
    const wanted = seedType;
    const seeds = bot.inventory.items().find((item) => item.name === wanted);
    if (!seeds) {
      console.log(`No ${seedType} to plant.`);
      return false;
    }
    // Seeds go on top of the farmland (they used to be "placed" below it)
    const sown = await placeBlockAt(seeds.name, abovePos, { against: new Vec3(0, -1, 0) });
    if (!sown.ok) {
      console.log(`Couldn't plant ${seedType} at ${abovePos}: ${describeFailure(sown)}`);
      return false;
    }
    console.log(`Planted ${seedType} at ${abovePos}.`);
  }
  return true;
}

/** Waits briefly for the block at `pos` to become `name` (the server's answer). */
async function settlesTo(pos: Vec3, name: string, ms = 1000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (knownBlock(pos)?.name === name) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return knownBlock(pos)?.name === name;
}
