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
import { shelter } from "./capabilities";

type P3 = { x: number; y: number; z: number };

// The plot: 9 x 9 round its middle (water reaches 4 blocks)
export const FARM_HALF = 4;
// How far from the top of its stairs the plot's middle may be
// Field sizes it tries, biggest first (half-widths: 9x9, 7x7, 5x5): a smaller
// field where the ground's too uneven for a big one
export const FIELD_HALVES = [4, 3, 2];
// Fields are made this close to its home (levelled with dirt where needed:
// owner, take a bunch of dirt and build it near the shelter)
const NEAR_HOME = 16;
export const FIELD_RANGE = 24;
// Blocks it may move to level a field, per size (beyond: a smaller field)
// (game test, snowy hills: nothing within 16 blocks fit the first, tight limits)
const LEVEL_BUDGET: Record<number, number> = { 4: 120, 3: 80, 2: 50 };
// Bumps dug out up to this high, dips filled this deep
const MAX_BUMP = 4;
const MAX_DIP = 3;

// A field starts 5x5 and grows a ring at a time, to 7x7 and 9x9, in the
// ground kept for it (owner: start small, the space reserved)
export const FIRST_HALF = 2;
// Seeds, best first: what it plants (the crop block and the item it plants)
const SEEDS = ["carrot", "potato", "beetroot_seeds", "wheat_seeds"] as const;
// Grass broken for wheat seeds before it gives up on more (1 in 8 drops one)
const GRASS_TRIES = 80;
const SEEDS_WANTED = 40;

// Fields it keeps (owner: at least 2 to live on)
export const FIELDS_WANTED = 2;

/** Its fields (each plot's middle), first made first. */
export type Field = P3 & { name: string; seed: string; half: number; reserve: number };

/** Its fields: each plot's middle, how far it's planted (`half`) and the ground kept for it (`reserve`). */
export function myFarms(): Field[] {
  // Only fields by its home (owner: one 40 blocks off is no use; an older
  // far one is left as it is)
  const home = shelter();
  const nearHome = (p: P3): boolean => !home || Math.hypot(p.x - home.x, p.z - home.z) <= FIELD_RANGE;
  return getPlaces("farm")
    .filter((p) => p.dimension === currentDimension() && (p.name ?? "").startsWith("my farm") && nearHome(p))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
    .map((p) => {
      const d = (p.details ?? {}) as { half?: number; reserve?: number; seed?: string };
      const half = Number(d.half ?? FARM_HALF);
      return { x: p.x, y: p.y, z: p.z, name: p.name ?? "my farm", seed: d.seed ?? "wheat_seeds", half, reserve: Number(d.reserve ?? half) };
    });
}

/**
 * The next size for a field: a ring wider once every cell it has is sown
 * (`bare` cells left: none, or one odd cell that won't take), up to the
 * ground kept for it. Pure.
 */
export function nextHalf(half: number, reserve: number, bare: number): number {
  return bare <= 1 && half < reserve ? half + 1 : half;
}

/** Its first field (the plot's middle), or null. */
export function myFarm(): Field | null {
  return myFarms()[0] ?? null;
}

// Plants it clears off the plot (never anything else: an owner's fence,
// lantern or table on it stays, review)
// (and thin snow: owner, in a snowy world the plot is under a snow layer)
const CLEARABLE = /^(short_grass|grass|tall_grass|fern|large_fern|dandelion|poppy|[a-z_]+_tulip|azure_bluet|oxeye_daisy|cornflower|allium|blue_orchid|snow)$/;

/**
 * A plot cell as the site search sees it (null: not loaded): grass or dirt
 * (`ground`), air or a plant (`clear`), open sky over it (`sky`: nothing
 * solid and no leaves, crops need the light), part of a tree (`tree`).
 */
export type PlotCell = { ground: boolean; clear: boolean; sky?: boolean; tree?: boolean } | null;

/**
 * True when a 9 x 9 plot round `middle` fits: every cell grass or dirt at
 * the same height (`ground`), with nothing but air or a plant over it
 * (`clear`), none of it kept (its shelter, its stairs) or off limits. Pure
 * over `look` and `kept`.
 */
export function plotFits(middle: P3, look: (x: number, y: number, z: number) => PlotCell, kept: (p: P3) => boolean = () => false, half = FARM_HALF): boolean {
  for (let dx = -half; dx <= half; dx++) {
    for (let dz = -half; dz <= half; dz++) {
      const g = { x: middle.x + dx, y: middle.y, z: middle.z + dz };
      const ground = look(g.x, g.y, g.z);
      const over = look(g.x, g.y + 1, g.z);
      if (!ground?.ground || ground.sky === false || !over?.clear || kept(g) || kept({ ...g, y: g.y + 1 })) return false;
    }
  }
  // No tree right by it (game test: a plot squeezed between oaks, in their
  // shade, leaves and saplings dropping on it)
  for (let dx = -half - 1; dx <= half + 1; dx++) {
    for (let dz = -half - 1; dz <= half + 1; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== half + 1) continue;
      for (let dy = 0; dy <= 3; dy++) if (look(middle.x + dx, middle.y + dy, middle.z + dz)?.tree) return false;
    }
  }
  return true;
}

/**
 * The plot's cells in the order they're sown: from the water outward, ring
 * by ring, so a few seeds make a patch round the water that grows as the
 * harvests give more (game test: 8 seeds made one strip along an edge).
 * The middle (the water) is left out. Pure.
 */
export function sowOrder(middle: P3, half = FARM_HALF): P3[] {
  const cells: P3[] = [];
  for (let dx = -half; dx <= half; dx++) for (let dz = -half; dz <= half; dz++) if (dx !== 0 || dz !== 0) cells.push({ x: middle.x + dx, y: middle.y, z: middle.z + dz });
  const ring = (p: P3): number => Math.max(Math.abs(p.x - middle.x), Math.abs(p.z - middle.z));
  const manhattan = (p: P3): number => Math.abs(p.x - middle.x) + Math.abs(p.z - middle.z);
  return cells.sort((a, b) => ring(a) - ring(b) || manhattan(a) - manhattan(b));
}

/**
 * Where its torches go: one beside the middle of each side, just off the
 * plot. Light 14 falls by one a block, so every cell gets 9 or more: crops
 * grow at night and nothing spawns on it. Pure.
 */
export function torchSpots(middle: P3, half = FARM_HALF): P3[] {
  const d = half + 1;
  // The corners too (owner: torches all round the crops; light keeps snow
  // and mobs off the paths round it)
  const out: P3[] = [];
  for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [d, -d], [-d, d], [-d, -d]] as const) out.push({ x: middle.x + dx, y: middle.y + 1, z: middle.z + dz });
  return out;
}


/** A cell as the levelling sees it (null: not loaded). */
export type LevelCell = { name: string; solid: boolean } | null;
const DIRT = /^(grass_block|dirt)$/;

/**
 * What it takes to level a plot round `middle` (its ground at middle.y): a
 * block for each bump dug out above the ground, each stone or snow block in
 * the ground swapped for dirt, each dip filled with dirt. Null when it can't
 * be (something kept, a tree, a bump over 2 high, a dip over 2 deep, a roof
 * over it). Pure over `look` and `kept`.
 */
export function levelCost(middle: P3, half: number, look: (x: number, y: number, z: number) => LevelCell, kept: (p: P3) => boolean = () => false): number | null {
  let cost = 0;
  for (let dx = -half; dx <= half; dx++) {
    for (let dz = -half; dz <= half; dz++) {
      const x = middle.x + dx;
      const z = middle.z + dz;
      const y = middle.y;
      if (kept({ x, y, z }) || kept({ x, y: y + 1, z })) return null;
      // Above the ground: a bump dug out (leaves too); higher is a hill; a trunk stays
      for (let dy = 1; dy <= MAX_BUMP + 1; dy++) {
        const c = look(x, y + dy, z);
        if (!c) return null;
        if (/_log$/.test(c.name)) return null;
        if (c.solid) {
          if (dy > MAX_BUMP) return null;
          cost++;
        }
      }
      // Open sky over it (crops need the light): no stone overhead; leaves are cleared
      for (let dy = MAX_BUMP + 2; dy <= 10; dy++) {
        const c = look(x, y + dy, z);
        if (c?.solid && !/_leaves$/.test(c.name)) return null;
      }
      // The ground: dirt as it is; stone or snow swapped; a dip filled
      const g = look(x, y, z);
      if (!g) return null;
      if (DIRT.test(g.name)) continue;
      cost++;
      if (!g.solid) {
        let filled = false;
        for (let d = 1; d <= MAX_DIP; d++) {
          if (look(x, y - d, z)?.solid) {
            filled = true;
            break;
          }
          cost++;
        }
        if (!filled) return null;
      }
    }
  }
  return cost;
}

/** The live view for levelling. */
function levelCellAt(x: number, y: number, z: number): LevelCell {
  const b = knownBlock(new Vec3(x, y, z));
  if (!b) return null;
  return { name: b.name, solid: b.boundingBox === "block" && !/^(water|lava)$/.test(b.name) };
}

/** Where the ground is in a column near `y` (the top solid block from 3 above to 3 below), or null. */
function groundAt(x: number, z: number, y: number): number | null {
  for (let yy = y + 3; yy >= y - 3; yy--) if (levelCellAt(x, yy, z)?.solid && !levelCellAt(x, yy + 1, z)?.solid) return yy;
  return null;
}

/**
 * A plot by its home (owner: a field by the shelter, levelled with dirt,
 * not a flat one far off): the biggest size whose levelling fits its
 * budget, the least work of that size, nearest on a tie.
 */
function findPlot(home: P3): { middle: P3; half: number } | null {
  // Never on another of its fields (or right against one: a path between)
  const fields = myFarms();
  let checked = 0;
  let cheapest: number | null = null;
  for (const half of FIELD_HALVES) {
    const onField = (p: P3): boolean => fields.some((f) => Math.max(Math.abs(p.x - f.x), Math.abs(p.z - f.z)) <= f.reserve + half + 1);
    const kept = (p: P3): boolean => isProtected(p) || forbiddenAt(new Vec3(p.x, p.y, p.z)) !== null;
    let best: { middle: P3; cost: number; r: number } | null = null;
    for (let r = half + 3; r <= NEAR_HOME; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = home.x + dx;
          const z = home.z + dz;
          if (onField({ x, y: home.y, z })) continue;
          const y = groundAt(x, z, home.y - 1);
          if (y === null) continue;
          const middle = { x, y, z };
          const cost = levelCost(middle, half, levelCellAt, kept);
          checked++;
          if (cost === null) continue;
          if (cheapest === null || cost < cheapest) cheapest = cost;
          if (cost > LEVEL_BUDGET[half]!) continue;
          if (!best || cost < best.cost) best = { middle, cost, r };
        }
      }
    }
    if (best) return { middle: best.middle, half };
  }
  // Why not, for the log
  console.log(`Farm: no spot by home: ${checked} checked, ${cheapest === null ? "none levellable (hills, trunks, a roof or kept ground)" : `the cheapest needs ${cheapest} blocks moved`}.`);
  return null;
}

/**
 * Levels a field's planted part: bumps dug out, stone or snow in the ground
 * swapped for dirt, dips filled with dirt (from what it carries, its
 * chests, or dug nearby). True when it's ready to till.
 */
async function levelPlot(middle: P3, half: number): Promise<boolean> {
  const need = levelCost(middle, half, levelCellAt) ?? 0;
  if (need === 0) return true;
  const { storedNear, takeItems } = await import("../actions/storage");
  if (count("dirt") < need && storedNear("dirt", 32) > 0) await takeItems([{ name: "dirt", count: need - count("dirt") }], true);
  if (count("dirt") < need) {
    const { collectBlock } = await import("../actions/collectBlock");
    await collectBlock("dirt", need - count("dirt"), 24);
  }
  const { breakBlock } = await import("../core/primitives");
  const { placeBlockResult } = await import("../actions/blockPlacing");
  const cells = sowOrder(middle, half).concat([{ ...middle }]);
  let moved = 0;
  for (const c of cells) {
    if (isCommandCancelled()) return false;
    if (!(await goTo(new pf.goals.GoalNear(c.x, c.y + 1, c.z, 3))).ok) continue;
    // Bumps over the ground
    for (let dy = MAX_BUMP; dy >= 1; dy--) {
      const above = levelCellAt(c.x, c.y + dy, c.z);
      if (above?.solid && (await breakBlock(new Vec3(c.x, c.y + dy, c.z), { allowWithoutHarvest: true })).ok) moved++;
    }
    const g = levelCellAt(c.x, c.y, c.z);
    if (!g || DIRT.test(g.name)) continue;
    // Stone, snow or the like in the ground: out, dirt in
    if (g.solid && !(await breakBlock(new Vec3(c.x, c.y, c.z), { allowWithoutHarvest: true })).ok) continue;
    // A dip: filled from the bottom up
    // (from just over the first solid block below, up to the ground)
    let from = 0;
    for (let d = 1; d <= MAX_DIP; d++) {
      if (levelCellAt(c.x, c.y - d, c.z)?.solid) break;
      from = -d;
    }
    for (let dy = from; dy <= 0; dy++) {
      const cell = levelCellAt(c.x, c.y + dy, c.z);
      if (cell?.solid || count("dirt") === 0) continue;
      if ((await placeBlockResult("dirt", c.x, c.y + dy, c.z, "bottom")).ok) moved++;
    }
  }
  const { pickupNearbyItems } = await import("../actions/pickup");
  await pickupNearbyItems(bot, 6);
  if (moved > 0) console.log(`Farm: levelled the field at ${middle.x}, ${middle.z} (${moved} blocks moved).`);
  return true;
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
  const { breakBlock, withinReach } = await import("../core/primitives");
  const { pickupNearbyItems } = await import("../actions/pickup");
  let broken = 0;
  const done = new Set<string>();
  // The nearest grass from where it stands now, and every blade in reach
  // there, then on to the next nearest (owner: not one here, one there)
  for (let walks = 0; walks < GRASS_TRIES && count("wheat_seeds") < SEEDS_WANTED && !isCommandCancelled(); walks++) {
    const near = bot
      .findBlocks({ matching: ids, maxDistance: 48, count: 64 })
      .filter((p) => !done.has(p.toString()))
      .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    const p = near[0];
    if (!p) break;
    done.add(p.toString());
    if (!withinReach(p) && !(await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 2))).ok) continue;
    for (const q of near.filter((q) => withinReach(q))) {
      done.add(q.toString());
      if ((await breakBlock(q, { allowWithoutHarvest: true })).ok) broken++;
    }
    await pickupNearbyItems(bot, 3);
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
  if (myFarms().length >= FIELDS_WANTED) return ok();
  const { shelterLayout } = await import("../actions/building");
  const home = shelterLayout()?.start;
  if (!home) return fail("not_found", "no shelter to farm next to yet");
  const { daylight } = await import("../core/daylight");
  if (!daylight()) return fail("refused", "fields are made by day");
  const { acquire } = await import("./acquire");
  const { liveWorld } = await import("./world");
  // A hoe: stone if it can, wooden on its first day
  if (!bot.inventory.items().some((i) => i.name.endsWith("_hoe"))) {
    let hoe = await acquire("stone_hoe", 1, liveWorld);
    if (!hoe.ok) hoe = await acquire("wooden_hoe", 1, liveWorld);
    if (!hoe.ok) return fail(hoe.reason, `no hoe (${describeFailure(hoe)})`);
  }
  const seed = await getSeeds();
  if (!seed) return fail("missing_items", "no seeds: no carrots, potatoes or beetroot, and the grass round here gave none");
  const plot = findPlot(home);
  if (!plot) return fail("not_found", "no open ground by my shelter I can level for a field, not even 5 by 5");
  const { middle } = plot;
  const reserve = plot.half;
  const half = Math.min(FIRST_HALF, reserve);
  const n = myFarms().length + 1;
  report(`Making ${n === 1 ? "my first field" : `field ${n}`} (${2 * half + 1} by ${2 * half + 1}, room to grow to ${2 * reserve + 1} by ${2 * reserve + 1}) at ${middle.x}, ${middle.z}: ${seed.replace(/_/g, " ")}${count("water_bucket") > 0 ? ", water in the middle" : "; water in its middle once I have a bucket"}.`);
  if (!(await goTo(new pf.goals.GoalNear(middle.x, middle.y + 1, middle.z, 2))).ok) return fail("unreachable", "I can't get to the field's spot");
  // Water now if it has it (owner: crops grow without it too, slower; the
  // middle gets it once it has a bucket)
  if (count("water_bucket") > 0) await waterField(middle);
  // Levelled first (dirt in the dips, bumps dug out)
  await levelPlot(middle, half);
  await addPlace({ kind: "farm", name: n === 1 ? "my farm" : `my farm ${n}`, x: middle.x, y: middle.y, z: middle.z, details: { seed, half, reserve } });
  const sown = await sowPlot(middle, seed, half);
  await lightFarm(middle, reserve);
  report(`Field ${n} is planted: ${sown} blocks of ${seed.replace(/_/g, " ")}${sown < (2 * half + 1) ** 2 - 1 ? "; it grows as the harvests give more seeds" : ""}.`);
  return sown > 0 ? (myFarms().length >= FIELDS_WANTED ? ok() : fail("not_found", `${FIELDS_WANTED - myFarms().length} more field to make`)) : fail("refused", "I couldn't till or sow the field");
}

/** The field's middle dug out and its water poured in (from a water bucket it carries). True when there's water. */
async function waterField(middle: P3): Promise<boolean> {
  const mid = new Vec3(middle.x, middle.y, middle.z);
  if (knownBlock(mid)?.name === "water") return true;
  if (count("water_bucket") === 0) return false;
  // The hole must hold the water: solid ground under it (a cave below would drain it)
  if (knownBlock(mid.offset(0, -1, 0))?.boundingBox !== "block") return false;
  const { breakBlock, equipItem, useHeldItemToward } = await import("../core/primitives");
  if (!(await goTo(new pf.goals.GoalNear(mid.x, mid.y + 1, mid.z, 2))).ok) return false;
  if (knownBlock(mid)?.name !== "air" && !(await breakBlock(mid, { allowWithoutHarvest: true })).ok) return false;
  if (!(await equipItem("water_bucket")).ok) return false;
  await useHeldItemToward({ x: mid.x + 0.5, y: mid.y, z: mid.z + 0.5 }); // the hole's floor
  await new Promise((r) => setTimeout(r, 500));
  const watered = knownBlock(mid)?.name === "water";
  if (watered) console.log(`Farm: water in the middle of the field at ${mid}.`);
  return watered;
}

/** Tills and sows every free cell of the plot (not the middle's water). How many it sowed. */
async function sowPlot(middle: P3, seed: string, half = FARM_HALF): Promise<number> {
  const { tillAndSow } = await import("../actions/farming");
  let sown = 0;
  // No hoe: only farmland already tilled is sown (game test: 80 "can't till, no hoe")
  const hoe = bot.inventory.items().some((i) => i.name.endsWith("_hoe"));
  for (const cell of sowOrder(middle, half)) {
    if (isCommandCancelled() || count(seed) === 0) return sown;
    const g = new Vec3(cell.x, cell.y, cell.z);
    if (!hoe && knownBlock(g)?.name !== "farmland") continue;
    const over = knownBlock(g.offset(0, 1, 0));
    if (over && over.name !== "air") {
      // Only a plant is cleared; a crop growing, a torch or anything else is left
      if (!CLEARABLE.test(over.name)) continue;
      const { breakBlock } = await import("../core/primitives");
      await breakBlock(over.position, { allowWithoutHarvest: true });
    }
    if (await tillAndSow(g.x, g.y, g.z, seed)) sown++;
  }
  return sown;
}

/** Its torches round the plot, those it has (a missing one put back when tended). How many it placed. */
async function lightFarm(middle: P3, half = FARM_HALF): Promise<number> {
  if (count("torch") === 0) return 0;
  const { placeBlockResult } = await import("../actions/blockPlacing");
  let placed = 0;
  for (const spot of torchSpots(middle, half)) {
    if (count("torch") === 0 || isCommandCancelled()) break;
    // On the ground there (it may be a block up or down from the plot)
    for (let dy = 1; dy >= -2; dy--) {
      const at = new Vec3(spot.x, spot.y + dy, spot.z);
      const here = knownBlock(at);
      const below = knownBlock(at.offset(0, -1, 0));
      if (here?.name === "torch") break;
      if (here?.name !== "air" || below?.boundingBox !== "block" || below.name === "farmland") continue;
      if (!(await goTo(new pf.goals.GoalNear(at.x, at.y, at.z, 3))).ok) break;
      if ((await placeBlockResult("torch", at.x, at.y, at.z, "bottom")).ok) placed++;
      break;
    }
  }
  if (placed > 0) console.log(`Farm: ${placed} torches round the plot.`);
  return placed;
}

/** Cells of a field not sown yet (no crop on them; the middle's water hole aside). */
function bareCells(f: Field): number {
  return sowOrder(f, f.half).filter((c) => {
    const over = knownBlock(new Vec3(c.x, c.y + 1, c.z));
    return over === null || over.name === "air" || CLEARABLE.test(over.name);
  }).length;
}

/** Ripe crops on its farm now. */
export function farmRipe(): number {
  return myFarms().reduce((n, f) => n + findRipeCrops(f.half + 2, null, new Vec3(f.x, f.y + 1, f.z)).length, 0);
}

/**
 * Looks after its farm: harvests what's ripe (replanting), sows any bare
 * farmland, bakes the wheat into bread. How many crops it harvested.
 */
export async function tendFarm(): Promise<number> {
  let harvested = 0;
  for (const farm of myFarms()) {
    if (isCommandCancelled()) break;
    const field = new Vec3(farm.x, farm.y + 1, farm.z);
    if (!(await goTo(new pf.goals.GoalNear(field.x, field.y, field.z, 4))).ok) continue;
    const { harvestCrops } = await import("../actions/farming");
    harvested += await harvestCrops({ maxDistance: farm.half + 2, point: field });
    // Bare farmland sown again, and the plot grown outward with the seeds the harvest gave
    const seed = SEEDS.find((s) => count(s) > 0);
    if (seed) await sowPlot(farm, seed, farm.half);
    // Every cell of it sown and seeds over: a ring wider (owner: 5x5, then 7x7, then 9x9)
    const grown = nextHalf(farm.half, farm.reserve, bareCells(farm));
    if (grown > farm.half && SEEDS.some((s2) => count(s2) > 0)) {
      await addPlace({ kind: "farm", name: farm.name, x: farm.x, y: farm.y, z: farm.z, details: { seed: farm.seed, half: grown, reserve: farm.reserve } });
      console.log(`Farm: ${farm.name} grows to ${2 * grown + 1} by ${2 * grown + 1}.`);
      await levelPlot(farm, grown);
      const more = SEEDS.find((s2) => count(s2) > 0);
      if (more) await sowPlot(farm, more, grown);
    }
    await lightFarm(farm, farm.reserve);
    // Its water, once it has a bucket of it (owner)
    await waterField(farm);
  }
  // Wheat into bread (3 each)
  const wheat = count("wheat");
  if (wheat >= 3) {
    const { acquire } = await import("./acquire");
    const { liveWorld } = await import("./world");
    const loaves = Math.floor(wheat / 3);
    const baked = await acquire("bread", count("bread") + loaves, liveWorld);
    if (baked.ok) console.log(`Farm: baked ${loaves} bread.`);
  }
  if (harvested > 0) report(`Harvested ${harvested} crops from my fields.`);
  return harvested;
}
