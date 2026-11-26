// Path: src/skills/farm.ts
// A farm of its own by the shelter, like a player (owner: hunting isn't a
// sustainable way to get food; build a plot near the shelter, with water in
// it, so make a water bucket first). A 9 x 9 plot of grass or dirt a few
// blocks from the top of its stairs: the middle block dug out and filled
// with water from its bucket (one water block keeps the whole 9 x 9 moist),
// the other 80 tilled and sown. When it needs food it harvests what's ripe
// (replanting as it goes) and bakes the wheat into bread.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { goTo, knownBlock } from "../core/primitives";
import { fail, ok, describeFailure, type ActionResult } from "../core/result";
import { isCommandCancelled } from "../core/commandContext";
import { report } from "../core/narrator";
import { isProtected } from "../core/movements";
import { forbiddenAt } from "../core/forbidden";
import { addPlace, getPlaces } from "../managers/persistenceManager";
import { currentDimension } from "../actions/perception";
import { findRipeCrops } from "../actions/farming";

type P3 = { x: number; y: number; z: number };

// The plot: 9 x 9 round its middle (water reaches 4 blocks)
export const FARM_HALF = 4;
// How far from the top of its stairs the plot's middle may be
const NEAR = 6;
const FAR = 24;
// Seeds, best first: what it plants (the crop block and the item it plants)
const SEEDS = ["carrot", "potato", "beetroot_seeds", "wheat_seeds"] as const;
// Grass broken for wheat seeds before it gives up on more (1 in 8 drops one)
const GRASS_TRIES = 80;
const SEEDS_WANTED = 40;

/** Its farm (the plot's middle), or null. */
export function myFarm(): P3 | null {
  const farm = getPlaces("farm").filter((p) => p.dimension === currentDimension() && p.name === "my farm").at(-1);
  return farm ? { x: farm.x, y: farm.y, z: farm.z } : null;
}

// Plants it clears off the plot (never anything else: an owner's fence,
// lantern or table on it stays, review)
const CLEARABLE = /^(short_grass|grass|tall_grass|fern|large_fern|dandelion|poppy|[a-z_]+_tulip|azure_bluet|oxeye_daisy|cornflower|allium|blue_orchid)$/;

/** A plot cell as the site search sees it (null: not loaded). */
export type PlotCell = { ground: boolean; clear: boolean } | null;

/**
 * True when a 9 x 9 plot round `middle` fits: every cell grass or dirt at
 * the same height (`ground`), with nothing but air or a plant over it
 * (`clear`), none of it kept (its shelter, its stairs) or off limits. Pure
 * over `look` and `kept`.
 */
export function plotFits(middle: P3, look: (x: number, y: number, z: number) => PlotCell, kept: (p: P3) => boolean = () => false): boolean {
  for (let dx = -FARM_HALF; dx <= FARM_HALF; dx++) {
    for (let dz = -FARM_HALF; dz <= FARM_HALF; dz++) {
      const g = { x: middle.x + dx, y: middle.y, z: middle.z + dz };
      const ground = look(g.x, g.y, g.z);
      const over = look(g.x, g.y + 1, g.z);
      if (!ground?.ground || !over?.clear || kept(g) || kept({ ...g, y: g.y + 1 })) return false;
    }
  }
  return true;
}

/** The live view for the plot search. */
function plotCellAt(x: number, y: number, z: number): PlotCell {
  const b = knownBlock(new Vec3(x, y, z));
  if (!b) return null;
  // Fresh grass or dirt only: farmland may be the owner's field (review)
  const ground = b.name === "grass_block" || b.name === "dirt";
  // Air or a plant; a torch too (its lit home's grid: the torch stays, that cell isn't sown)
  const clear = b.name === "air" || b.name === "torch" || CLEARABLE.test(b.name);
  return { ground, clear };
}

/** A plot near its home: the nearest that fits, round the top of its stairs. */
function findPlot(home: P3): P3 | null {
  const kept = (p: P3): boolean => isProtected(p) || forbiddenAt(new Vec3(p.x, p.y, p.z)) !== null;
  for (let r = NEAR; r <= FAR; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        // The ground's height there: within a few blocks of the home's
        for (let dy = 3; dy >= -3; dy--) {
          const middle = { x: home.x + dx, y: home.y + dy - 1, z: home.z + dz };
          if (plotFits(middle, plotCellAt, kept)) return middle;
        }
      }
    }
  }
  return null;
}

const count = (name: string): number => bot.inventory.items().filter((i) => i.name === name).reduce((n, i) => n + i.count, 0);

/**
 * Seeds to sow: what it carries (carrots, potatoes, beetroot, wheat), else
 * wheat seeds from the grass round about (broken by hand: about 1 in 8
 * drops a seed; the grass itself never drops without shears).
 */
async function getSeeds(): Promise<string | null> {
  const have = SEEDS.find((s) => count(s) >= 8);
  if (have) return have;
  const ids = ["short_grass", "grass", "tall_grass"].map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  const grass = bot.findBlocks({ matching: ids, maxDistance: 24, count: GRASS_TRIES });
  const { breakBlock } = await import("../core/primitives");
  const { pickupNearbyItems } = await import("../actions/pickup");
  let broken = 0;
  for (const p of grass) {
    if (count("wheat_seeds") >= SEEDS_WANTED || isCommandCancelled()) break;
    if (!(await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 2))).ok) continue;
    if ((await breakBlock(p, { allowWithoutHarvest: true })).ok) broken++;
    if (broken % 6 === 0) await pickupNearbyItems(bot, 4);
  }
  await pickupNearbyItems(bot, 6);
  console.log(`Farm: broke ${broken} grass for ${count("wheat_seeds")} wheat seeds.`);
  return SEEDS.find((s) => count(s) > 0) ?? null;
}

/**
 * Makes its farm: a hoe, seeds, the plot found, water poured in its middle,
 * the rest tilled and sown, and remembered. Done once; `tendFarm` keeps it.
 */
export async function makeFarm(): Promise<ActionResult> {
  if (myFarm()) return ok();
  const { shelterLayout } = await import("../actions/building");
  const home = shelterLayout()?.start;
  if (!home) return fail("not_found", "no shelter to farm next to yet");
  if (count("water_bucket") === 0) {
    const { fillWater } = await import("./endgame/portal");
    const filled = await fillWater();
    if (!filled.ok) return fail(filled.reason, `no water for the farm (${describeFailure(filled)})`);
  }
  const { acquire } = await import("./acquire");
  const { liveWorld } = await import("./world");
  if (!bot.inventory.items().some((i) => i.name.endsWith("_hoe"))) {
    const hoe = await acquire("stone_hoe", 1, liveWorld);
    if (!hoe.ok) return fail(hoe.reason, `no hoe (${describeFailure(hoe)})`);
  }
  const seed = await getSeeds();
  if (!seed) return fail("missing_items", "no seeds: no carrots, potatoes or beetroot, and the grass round here gave none");
  const middle = findPlot(home);
  if (!middle) return fail("not_found", "no flat 9 by 9 patch of grass near my shelter for a farm");
  report(`Making my farm at ${middle.x}, ${middle.z}: water in the middle, ${seed.replace(/_/g, " ")} round it.`);
  // The middle: dug out, its water poured in
  const { breakBlock, equipItem, useHeldItemToward } = await import("../core/primitives");
  const mid = new Vec3(middle.x, middle.y, middle.z);
  if (!(await goTo(new pf.goals.GoalNear(mid.x, mid.y + 1, mid.z, 2))).ok) return fail("unreachable", "I can't get to the farm's spot");
  if (knownBlock(mid)?.name !== "water") {
    // The hole must hold the water: solid ground under it (a cave below would drain it)
    if (knownBlock(mid.offset(0, -1, 0))?.boundingBox !== "block") return fail("refused", "the farm's middle has no solid ground under it");
    const dug = await breakBlock(mid);
    if (!dug.ok) return fail(dug.reason, `couldn't dig the farm's water hole (${describeFailure(dug)})`);
    if (!(await equipItem("water_bucket")).ok) return fail("missing_items", "no water bucket");
    await useHeldItemToward({ x: mid.x + 0.5, y: mid.y, z: mid.z + 0.5 }); // the hole's floor
    await new Promise((r) => setTimeout(r, 500));
    if (knownBlock(mid)?.name !== "water") return fail("refused", "the water didn't go in the farm's middle");
  }
  await addPlace({ kind: "farm", name: "my farm", x: middle.x, y: middle.y, z: middle.z, details: { seed } });
  const sown = await sowPlot(middle, seed);
  report(`My farm is planted: ${sown} blocks of ${seed.replace(/_/g, " ")}.`);
  return sown > 0 ? ok() : fail("refused", "I couldn't till or sow the farm");
}

/** Tills and sows every free cell of the plot (not the middle's water). How many it sowed. */
async function sowPlot(middle: P3, seed: string): Promise<number> {
  const { tillAndSow } = await import("../actions/farming");
  let sown = 0;
  for (let dx = -FARM_HALF; dx <= FARM_HALF; dx++) {
    for (let dz = -FARM_HALF; dz <= FARM_HALF; dz++) {
      if (isCommandCancelled()) return sown;
      if (dx === 0 && dz === 0) continue;
      const g = new Vec3(middle.x + dx, middle.y, middle.z + dz);
      const over = knownBlock(g.offset(0, 1, 0));
      if (over && over.name !== "air") {
        // Only a plant is cleared; a crop growing, a torch or anything else is left
        if (!CLEARABLE.test(over.name)) continue;
        const { breakBlock } = await import("../core/primitives");
        await breakBlock(over.position, { allowWithoutHarvest: true });
      }
      if (count(seed) === 0) return sown;
      if (await tillAndSow(g.x, g.y, g.z, seed)) sown++;
    }
  }
  return sown;
}

/** Ripe crops on its farm now. */
export function farmRipe(): number {
  const farm = myFarm();
  if (!farm) return 0;
  return findRipeCrops(FARM_HALF + 2, null, new Vec3(farm.x, farm.y + 1, farm.z)).length;
}

/**
 * Looks after its farm: harvests what's ripe (replanting), sows any bare
 * farmland, bakes the wheat into bread. How many crops it harvested.
 */
export async function tendFarm(): Promise<number> {
  const farm = myFarm();
  if (!farm) return 0;
  const field = new Vec3(farm.x, farm.y + 1, farm.z);
  if (!(await goTo(new pf.goals.GoalNear(field.x, field.y, field.z, 4))).ok) return 0;
  const { harvestCrops } = await import("../actions/farming");
  const harvested = await harvestCrops({ maxDistance: FARM_HALF + 2, point: field });
  // Bare farmland sown again (a crop trampled, a seed short last time)
  const seed = SEEDS.find((s) => count(s) > 0);
  if (seed) await sowPlot(farm, seed);
  // Wheat into bread (3 each)
  const wheat = count("wheat");
  if (wheat >= 3) {
    const { acquire } = await import("./acquire");
    const { liveWorld } = await import("./world");
    const loaves = Math.floor(wheat / 3);
    const baked = await acquire("bread", count("bread") + loaves, liveWorld);
    if (baked.ok) console.log(`Farm: baked ${loaves} bread.`);
  }
  if (harvested > 0) report(`Harvested ${harvested} crops from my farm.`);
  return harvested;
}
