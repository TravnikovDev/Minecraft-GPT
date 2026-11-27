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
import { chatter, report } from "../core/narrator";
import { isProtected, nearOwnPassage, protectCells, protectedBy } from "../core/movements";
import { forbiddenAt } from "../core/forbidden";
import { addPlace, getPlaces } from "../managers/persistenceManager";
import { currentDimension } from "../actions/perception";
import { findRipeCrops } from "../actions/farming";
import { shelter } from "./capabilities";
import { shelterSlots } from "../actions/building";

type P3 = { x: number; y: number; z: number };

// The plot: 9 x 9 round its middle (water reaches 4 blocks)
export const FARM_HALF = 4;
// How far from the top of its stairs the plot's middle may be
// Field sizes it tries, biggest first (half-widths: 9x9, 7x7, 5x5): a smaller
// field where the ground's too uneven for a big one
export const FIELD_HALVES = [4, 3, 2];
// Fields are made this close to its home (levelled with dirt where needed:
// owner, take a bunch of dirt and build it near the shelter)
// (owner: bigger fields, bread; four fields need a little more room)
const NEAR_HOME = 22;
export const FIELD_RANGE = 34;
// Blocks it may move to level a field, per size (beyond: a smaller field):
// the whole ground kept for it and the ring its fence stands on (owner: a
// flat surface of dirt first, then the field and its fence on it)
// (game test, snowy hills: nothing within 16 blocks fit the first, tight limits)
const LEVEL_BUDGET: Record<number, number> = { 4: 200, 3: 140, 2: 90 };
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
const SEEDS_WANTED = 64;

// Fields it keeps (owner: at least 2 to live on; then: bigger fields and
// bread, the animals round its home are too few to live on)
export const FIELDS_WANTED = 4;
// Ripe crops that make a harvest worth the walk, by day (bread: 3 wheat each)
export const RIPE_ENOUGH = 9;

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
      // The whole ground inside its fence is sown (owner: crops over the
      // whole territory, 9 by 9; fields started 5 by 5 are sown out now)
      const reserve = Number(d.reserve ?? d.half ?? FARM_HALF);
      return { x: p.x, y: p.y, z: p.z, name: p.name ?? "my farm", seed: d.seed ?? "wheat_seeds", half: reserve, reserve };
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

/**
 * Its fields' ground kept like its shelter's walls (the ground kept for
 * each, its fence's ring, and the layer under them): walks never dig it,
 * dirt is never collected from it, tunnels stop at it.
 */
export function protectFields(): void {
  const cells: P3[] = [];
  for (const f of myFarms()) {
    const d = f.reserve + 1;
    for (let dx = -d; dx <= d; dx++)
      for (let dz = -d; dz <= d; dz++) {
        cells.push({ x: f.x + dx, y: f.y, z: f.z + dz }, { x: f.x + dx, y: f.y - 1, z: f.z + dz });
      }
  }
  protectCells(cells, "farm");
}

/** Seeds it sows: kept on it when it puts things away (owner: 200 seeds sat in its chests while its fields stood bare). */
export const SEED_NAMES: readonly string[] = SEEDS;

/** Seeds of a kind it has, carried and in its chests near home. */
async function seedsOwned(seed: string): Promise<number> {
  const { storedNear } = await import("../actions/storage");
  return count(seed) + storedNear(seed, 32);
}

/** A hoe: stone if it can, wooden otherwise (game test: after a death it had none, and four hours went by with 3 seeds sown). */
async function ensureHoe(): Promise<ActionResult> {
  if (bot.inventory.items().some((i) => i.name.endsWith("_hoe"))) return ok();
  const { acquire } = await import("./acquire");
  const { liveWorld } = await import("./world");
  let hoe = await acquire("stone_hoe", 1, liveWorld);
  if (!hoe.ok) hoe = await acquire("wooden_hoe", 1, liveWorld);
  return hoe.ok ? ok() : fail(hoe.reason, `no hoe (${describeFailure(hoe)})`);
}

/** Seeds for `n` cells on it, from its chests if it carries fewer. */
async function seedsOnHand(seed: string, n: number): Promise<void> {
  if (count(seed) >= n) return;
  const { storedNear, takeItems } = await import("../actions/storage");
  if (storedNear(seed, 32) > 0) await takeItems([{ name: seed, count: n - count(seed) }], true);
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
// Ground that's tilled or tills (farmland already tilled stays as it is:
// game test, the levelling broke its fresh farmland and put dirt back)
const DIRT = /^(grass_block|dirt|farmland|dirt_path|coarse_dirt|rooted_dirt)$/;
// Its own things on the field: never "bumps" to dig out (the fence round it
// and its gate, the torches on the posts)
const ON_FIELD = /(_fence|_fence_gate|torch|_sign)$/;
// Dips filled this deep when a field is mended (a creeper's crater)
const REPAIR_DIP = 6;

/** What one column of a field needs to be level: bumps dug out (heights over the ground), the ground swapped, dirt to fill. */
export type ColumnWork = { x: number; z: number; bumps: number[]; swap: boolean; fill: number };

/**
 * What a column of the field at (x, z) needs to be level with its ground
 * at middle.y. A planted cell (`planted`: ring at most that far from the
 * middle) needs dirt or farmland at the top and open sky; the ring outside
 * it (where the fence stands) any solid ground. The middle may hold its
 * water. Null when it can't be (a trunk, a bump over MAX_BUMP high, a dip
 * deeper than `maxDip`, a roof over a planted cell). Pure over `look`.
 */
export function columnWork(middle: P3, x: number, z: number, planted: number, look: (x: number, y: number, z: number) => LevelCell, maxDip = MAX_DIP): ColumnWork | null {
  const y = middle.y;
  const ring = Math.max(Math.abs(x - middle.x), Math.abs(z - middle.z));
  // The ring outside its fence: a path round it, never higher than the
  // field (owner: the bank outside stood as high as the fence's top, so
  // mobs walked over it; "clear one more block round the fence")
  if (ring > planted + 1) return pathWork(x, y, z, look);
  const bumps: number[] = [];
  // Above the ground: a bump dug out (leaves too); higher is a hill; a trunk stays
  for (let dy = 1; dy <= MAX_BUMP + 1; dy++) {
    const c = look(x, y + dy, z);
    if (!c) return null;
    if (/_log$/.test(c.name)) return null;
    // Its fence stays only where it belongs: on the ring, right on the flat
    // ground. A post left over from before the levelling (floating over a
    // dug-out bump, or one too high) is taken down and put up again level
    // (game test: the fence went up and down round the field)
    const fenceInPlace = ON_FIELD.test(c.name) && ring > planted && dy === 1;
    if (c.solid && !fenceInPlace) {
      if (dy > MAX_BUMP) return null;
      bumps.push(dy);
    }
  }
  // Open sky over a planted cell (crops need the light): no stone overhead; leaves are cleared
  if (ring <= planted) {
    for (let dy = MAX_BUMP + 2; dy <= 10; dy++) {
      const c = look(x, y + dy, z);
      if (c?.solid && !/_leaves$/.test(c.name)) return null;
    }
  }
  const g = look(x, y, z);
  if (!g) return null;
  const done = { x, z, bumps, swap: false, fill: 0 };
  if (ring === 0 && g.name === "water") return done;
  // A post sunk in a dip (put up before the levelling): out, dirt in
  if (ON_FIELD.test(g.name)) return { ...done, swap: true };
  if (ring > planted ? g.solid : DIRT.test(g.name)) return done;
  // Stone, sand or snow in the ground: swapped for dirt
  if (g.solid) return { ...done, swap: true };
  // A dip: filled up from the first solid block below
  for (let d = 1; d <= maxDip; d++) if (look(x, y - d, z)?.solid) return { ...done, fill: d };
  return null;
}

// Natural ground and plants a path round a field is cleared of (never
// something built: a fence, a wall, the owner's things)
const PATH_BUMP = /^(dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|clay|sand|red_sand|gravel|stone|andesite|diorite|granite|tuff|deepslate|snow_block|snow|[a-z_]+_leaves)$/;

/**
 * The path round a field's fence: natural ground or plants above the
 * field's level dug out, up to MAX_BUMP high (a dip stays: lower ground
 * outside is no way in). Something built there is left alone. Null over a
 * hill or a trunk. Pure over `look`.
 */
function pathWork(x: number, y: number, z: number, look: (x: number, y: number, z: number) => LevelCell): ColumnWork | null {
  const bumps: number[] = [];
  for (let dy = 1; dy <= MAX_BUMP + 1; dy++) {
    const c = look(x, y + dy, z);
    if (!c) return null;
    if (/_log$/.test(c.name)) return null;
    if (ON_FIELD.test(c.name)) break; // a neighbour field's fence: left standing
    const plant = CLEARABLE.test(c.name);
    if ((c.solid && PATH_BUMP.test(c.name)) || plant) {
      if (dy > MAX_BUMP) return null;
      bumps.push(dy);
    }
  }
  return { x, z, bumps, swap: false, fill: 0 };
}

/** Blocks a column's work moves. */
const workCost = (w: ColumnWork): number => w.bumps.length + (w.swap ? 1 : 0) + w.fill;

/**
 * What it takes to level a field round `middle` (its ground at middle.y),
 * `half` rings out: a block for each bump dug out, each stone or snow block
 * in the ground swapped for dirt, each dip filled with dirt. The rings up
 * to `planted` are sown; the ones outside are its fence's ground. Null when
 * it can't be (something kept, a tree, a hill, a deep dip, a roof). Pure
 * over `look` and `kept`.
 */
export function levelCost(middle: P3, half: number, look: (x: number, y: number, z: number) => LevelCell, kept: (p: P3) => boolean = () => false, planted = half): number | null {
  let cost = 0;
  for (let dx = -half; dx <= half; dx++) {
    for (let dz = -half; dz <= half; dz++) {
      const x = middle.x + dx;
      const z = middle.z + dz;
      if (kept({ x, y: middle.y, z }) || kept({ x, y: middle.y + 1, z })) return null;
      const w = columnWork(middle, x, z, planted, look);
      if (!w) return null;
      cost += workCost(w);
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

// How far ahead of its shelter's back door the way of its mine's stairs is
// kept clear of fields, and how wide (the stairs and their walls, a path)
const MINE_WAY_LENGTH = 34;
const MINE_WAY_HALF_WIDTH = 2;

/** Its shelter's back door and the way its mine goes from it, or null. */
function shelterExitWay(): { exit: P3; step: { x: number; z: number } } | null {
  const slots = shelterSlots();
  if (!slots?.exit || !slots.direction) return null;
  const step = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } }[slots.direction as "north" | "south" | "east" | "west"];
  return step ? { exit: slots.exit, step } : null;
}

/**
 * True for a column on the way its mine's stairs go from its shelter's back
 * door (game test: its first field went right over the back doorway, its
 * gate above the stairs' first steps, and every walk out the back tried to
 * climb through that gate). Pure.
 */
export function onMineWay(p: { x: number; z: number }, way: { exit: { x: number; z: number }; step: { x: number; z: number } } | null): boolean {
  if (!way) return false;
  const dx = p.x - way.exit.x;
  const dz = p.z - way.exit.z;
  const along = dx * way.step.x + dz * way.step.z;
  const across = Math.abs(dx * way.step.z - dz * way.step.x);
  return along >= -1 && along <= MINE_WAY_LENGTH && across <= MINE_WAY_HALF_WIDTH;
}

/**
 * A plot by its home (owner: a field by the shelter, levelled with dirt,
 * not a flat one far off): the biggest size whose levelling fits its
 * budget, the least work of that size, nearest on a tie.
 */
function findPlot(home: P3): { middle: P3; half: number } | null {
  // Never on another of its fields (or right against one: a path between)
  const fields = myFarms();
  const mineWay = shelterExitWay();
  let checked = 0;
  let cheapest: number | null = null;
  for (const half of FIELD_HALVES) {
    // (both fences and a path between them)
    const onField = (p: P3): boolean => fields.some((f) => Math.max(Math.abs(p.x - f.x), Math.abs(p.z - f.z)) <= f.reserve + half + 3);
    const kept = (p: P3): boolean => isProtected(p) || nearOwnPassage(p) || forbiddenAt(new Vec3(p.x, p.y, p.z)) !== null || onMineWay(p, mineWay);
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
          const cost = levelCost(middle, half + 1, levelCellAt, kept, half);
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
 * Levels a field (owner: a flat surface first, made with dirt, then the
 * field on it, and its fence on it too): the whole ground kept for it
 * (`reserve` rings) and the ring outside it where the fence stands. Bumps
 * dug out, stone or snow in the sown ground swapped for dirt, dips filled
 * with dirt (from what it carries, its chests, or dug nearby, never from a
 * field). Also how a field is mended when it's tended (a creeper's crater
 * filled, like its shelter's walls). How many blocks it moved.
 */
async function levelPlot(middle: P3, reserve: number): Promise<number> {
  // The ground kept for it, the fence's ring and the path round the fence
  const area = reserve + 2;
  const kept = (p: P3): boolean => {
    const by = protectedBy(p);
    return (by !== null && by !== "farm") || forbiddenAt(new Vec3(p.x, p.y, p.z)) !== null;
  };
  const work = (): ColumnWork[] => {
    const out: ColumnWork[] = [];
    for (let dx = -area; dx <= area; dx++)
      for (let dz = -area; dz <= area; dz++) {
        const x = middle.x + dx;
        const z = middle.z + dz;
        if (kept({ x, y: middle.y, z })) continue;
        const w = columnWork(middle, x, z, reserve, levelCellAt, REPAIR_DIP);
        if (w && workCost(w) > 0) out.push(w);
      }
    return out;
  };
  const todo = work();
  if (todo.length === 0) return 0;
  const need = todo.reduce((n, w) => n + (w.swap ? 1 : 0) + w.fill, 0);
  if (count("dirt") < need) {
    const { storedNear, takeItems } = await import("../actions/storage");
    if (storedNear("dirt", 32) > 0) await takeItems([{ name: "dirt", count: need - count("dirt") }], true);
  }
  if (count("dirt") < need) {
    // Dug from the ground it can see round the field (its fields and home
    // are kept; never a tunnel from its shelter: it broke the roof that way)
    if (!(await goTo(new pf.goals.GoalNear(middle.x, middle.y + 1, middle.z, 3))).ok) return 0;
    const { collectBlock } = await import("../actions/collectBlock");
    for (const ground of ["dirt", "grass_block"]) if (count("dirt") < need) await collectBlock(ground, need - count("dirt"), 20, { seenOnly: true });
    if (count("dirt") < need) console.log(`Farm: only ${count("dirt")} dirt of the ${need} the field at ${middle.x}, ${middle.z} needs; the rest next time.`);
  }
  const { breakBlock } = await import("../core/primitives");
  const { placeBlockResult } = await import("../actions/blockPlacing");
  let moved = 0;
  // Nearest first from the middle outward
  const ring = (w: ColumnWork): number => Math.max(Math.abs(w.x - middle.x), Math.abs(w.z - middle.z));
  for (const w of todo.sort((a, b) => ring(a) - ring(b))) {
    if (isCommandCancelled()) break;
    if (!(await goTo(new pf.goals.GoalNear(w.x, middle.y + 1, w.z, 3))).ok) continue;
    // Bumps over the ground, top down
    for (const dy of [...w.bumps].sort((a, b) => b - a)) {
      if ((await breakBlock(new Vec3(w.x, middle.y + dy, w.z), { allowWithoutHarvest: true })).ok) moved++;
    }
    // Stone, snow or the like in the ground: out, dirt in
    if (w.swap && count("dirt") > 0 && !(await breakBlock(new Vec3(w.x, middle.y, w.z), { allowWithoutHarvest: true })).ok) continue;
    // A dip (or the swapped cell): filled from the bottom up, not standing in it
    const from = w.swap ? 0 : 1 - w.fill;
    const feet = bot.entity.position.floored();
    if (feet.x === w.x && feet.z === w.z) await goTo(new pf.goals.GoalInvert(new pf.goals.GoalNear(w.x, feet.y, w.z, 1)));
    for (let dy = from; dy <= 0; dy++) {
      if (count("dirt") === 0) break;
      if (levelCellAt(w.x, middle.y + dy, w.z)?.solid) continue;
      if ((await placeBlockResult("dirt", w.x, middle.y + dy, w.z, "bottom")).ok) moved++;
    }
  }
  const { pickupNearbyItems } = await import("../actions/pickup");
  await pickupNearbyItems(bot, 6);
  const left = work().length;
  if (moved > 0) console.log(`Farm: levelled the field at ${middle.x}, ${middle.z}, its fence ring and the path round it (${moved} blocks moved${left > 0 ? `, ${left} spots left` : ""}).`);
  return moved;
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
 * True when its next field has to wait ("not yet", never a failure: owner,
 * "Couldn't get my fields" every few minutes): a field it has isn't sown
 * all over, or there aren't the seeds for a whole new one. `owned`: carried
 * and in its chests. The first field doesn't wait (it gathers its seeds).
 */
export function nextFieldWaits(owned: (name: string) => number): boolean {
  const fields = myFarms();
  if (fields.length === 0) return false;
  if (fields.some((f) => bareCells(f) > 1)) return true;
  const want = (2 * FARM_HALF + 1) ** 2 - 1;
  return !SEEDS.some((s) => owned(s) >= want);
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
  const { workingTime } = await import("../core/daylight");
  if (!workingTime()) return fail("refused", "a mob attacked me tonight; fields wait for the morning");
  // The next field only once the ones it has are sown all over, and with the
  // seeds for a whole new one (owner: one field full, then the next from
  // its seeds)
  const fields = myFarms();
  const unfinished = fields.find((f) => bareCells(f) > 1);
  if (unfinished) return fail("not_found", `${unfinished.name} isn't sown all over yet`);
  const hoe = await ensureHoe();
  if (!hoe.ok) return hoe;
  let seed: string | null = null;
  if (fields.length === 0) seed = await getSeeds();
  else {
    const want = (2 * FARM_HALF + 1) ** 2 - 1;
    for (const s of SEEDS) if ((await seedsOwned(s)) >= want) seed = s;
    if (!seed) return fail("missing_items", `not enough seeds for a new field yet (${Math.max(...(await Promise.all(SEEDS.map(seedsOwned))))} of ${want}; the harvests bring more)`);
  }
  if (!seed) return fail("missing_items", "no seeds: no carrots, potatoes or beetroot, and the grass round here gave none");
  const plot = findPlot(home);
  if (!plot) return fail("not_found", "no open ground by my shelter I can level for a field, not even 5 by 5");
  const { middle } = plot;
  const reserve = plot.half;
  const half = reserve;
  const n = myFarms().length + 1;
  report(`Making ${n === 1 ? "my first field" : `field ${n}`} (${2 * half + 1} by ${2 * half + 1}, sown all over) at ${middle.x}, ${middle.z}: ${seed.replace(/_/g, " ")}${count("water_bucket") > 0 ? ", water in the middle" : "; water in its middle once I have a bucket"}.`);
  if (!(await goTo(new pf.goals.GoalNear(middle.x, middle.y + 1, middle.z, 2))).ok) return fail("unreachable", "I can't get to the field's spot");
  // Water now if it has it (owner: crops grow without it too, slower; the
  // middle gets it once it has a bucket)
  if (count("water_bucket") > 0) await waterField(middle);
  // A flat surface first, the whole ground kept for it and its fence's ring
  // (owner: flat with dirt, then the field on it, the fence on it too)
  await levelPlot(middle, reserve);
  await addPlace({ kind: "farm", name: n === 1 ? "my farm" : `my farm ${n}`, x: middle.x, y: middle.y, z: middle.z, details: { seed, half, reserve } });
  protectFields();
  await seedsOnHand(seed, (2 * half + 1) ** 2 - 1);
  const sown = await sowPlot(middle, seed, half);
  await fenceField(middle, reserve);
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
/**
 * The fence round a field (owner: fences round it, torches on top): every
 * cell of the ring just outside the ground kept for it, and the gate, the
 * middle of the side facing home. Columns only (x, z). Pure.
 */
export function fenceRing(middle: P3, reserve: number, home: { x: number; z: number }): { posts: Array<{ x: number; z: number }>; gate: { x: number; z: number } } {
  const d = reserve + 1;
  const posts: Array<{ x: number; z: number }> = [];
  for (let dx = -d; dx <= d; dx++) for (let dz = -d; dz <= d; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === d) posts.push({ x: middle.x + dx, z: middle.z + dz });
  // The side facing home: the axis home is farther along
  const ax = home.x - middle.x;
  const az = home.z - middle.z;
  const gate = Math.abs(ax) >= Math.abs(az) ? { x: middle.x + Math.sign(ax || 1) * d, z: middle.z } : { x: middle.x, z: middle.z + Math.sign(az) * d };
  return { posts: posts.filter((p) => p.x !== gate.x || p.z !== gate.z), gate };
}

/**
 * The ways a field's gate may face: along the way in through its side (a
 * gate on the east or west side faces east or west, so it lines up with
 * the fence running north-south). Pure.
 */
export function gateFacing(middle: { x: number; z: number }, gate: { x: number; z: number }): string[] {
  return gate.x !== middle.x ? ["east", "west"] : ["north", "south"];
}

/** The wood it builds fences from: the planks it carries most of ("spruce"), or null. */
function fenceWood(): string | null {
  const planks = bot.inventory.items().filter((i) => i.name.endsWith("_planks")).sort((a, b) => b.count - a.count)[0];
  return planks ? planks.name.replace(/_planks$/, "") : null;
}

/** The cell over the ground in a column near `y`, where a post stands (null: none, or something in the way). */
function postCell(x: number, z: number, y: number): Vec3 | null {
  for (let yy = y + 2; yy >= y - 2; yy--) {
    const at = new Vec3(x, yy, z);
    const here = knownBlock(at);
    const below = knownBlock(at.offset(0, -1, 0));
    if (!here || !below) continue;
    const open = here.name === "air" || CLEARABLE.test(here.name) || /_fence(_gate)?$/.test(here.name) || here.name === "torch";
    if (open && below.boundingBox === "block" && !/_fence(_gate)?$/.test(below.name)) return at;
  }
  return null;
}

/**
 * Fences its field in (owner: mobs walked on it; fences round it and torches
 * on top of them): posts all round the ground kept for it, a gate on the
 * side facing home, torches on the corner and middle posts. What's missing
 * is put up when it tends the field. How many blocks it placed.
 */
async function fenceField(middle: P3, reserve: number): Promise<number> {
  const home = shelter();
  const wood = fenceWood();
  if (!home || !wood) return lightFarm(middle, reserve);
  const fence = `${wood}_fence`;
  const gateName = `${wood}_fence_gate`;
  const { posts, gate } = fenceRing(middle, reserve, home);
  const cells = posts.map((p) => postCell(p.x, p.z, middle.y + 1)).filter((c): c is Vec3 => c !== null);
  const missing = cells.filter((c) => !/_fence$/.test(knownBlock(c)?.name ?? ""));
  const { acquire } = await import("./acquire");
  const { liveWorld } = await import("./world");
  if (missing.length > 0 && count(fence) < missing.length) await acquire(fence, missing.length, liveWorld);
  const gateCell = postCell(gate.x, gate.z, middle.y + 1);
  if (gateCell && !/_fence_gate$/.test(knownBlock(gateCell)?.name ?? "") && count(gateName) === 0) await acquire(gateName, 1, liveWorld);
  const { placeBlockResult } = await import("../actions/blockPlacing");
  const { breakBlock } = await import("../core/primitives");
  let placed = 0;
  const put = async (name: string, at: Vec3): Promise<void> => {
    if (count(name) === 0 || isCommandCancelled()) return;
    if (!(await goTo(new pf.goals.GoalNear(at.x, at.y, at.z, 3))).ok) return;
    const there = knownBlock(at);
    if (there && CLEARABLE.test(there.name)) await breakBlock(at, { allowWithoutHarvest: true });
    if ((await placeBlockResult(name, at.x, at.y, at.z, "bottom")).ok) placed++;
  };
  for (const c of missing) await put(fence, c);
  if (gateCell) {
    // The gate turned across the way in (owner: it stood sideways in the
    // fence): one facing the wrong way taken out and put back, placed while
    // the bot stands in line with the way in, looking along it
    const want = gateFacing(middle, gate);
    const now = knownBlock(gateCell);
    if (now && /_fence_gate$/.test(now.name) && !want.includes(String(now.getProperties()["facing"]))) {
      await goTo(new pf.goals.GoalNear(gateCell.x, gateCell.y, gateCell.z, 3));
      if ((await breakBlock(gateCell)).ok) {
        const { pickupNearbyItems } = await import("../actions/pickup");
        await pickupNearbyItems(bot, 4);
      }
    }
    if (!/_fence_gate$/.test(knownBlock(gateCell)?.name ?? "") && count(gateName) > 0 && !isCommandCancelled()) {
      const out = { x: Math.sign(gate.x - middle.x), z: Math.sign(gate.z - middle.z) };
      const stand = new Vec3(gateCell.x + out.x * 2, gateCell.y, gateCell.z + out.z * 2);
      await goTo(new pf.goals.GoalBlock(stand.x, stand.y, stand.z));
      await put(gateName, gateCell);
    }
  }
  if (placed > 0) console.log(`Farm: ${placed} fence posts and gate round the field at ${middle.x}, ${middle.z}.`);
  return placed + (await lightFarm(middle, reserve));
}

/**
 * Its torches round the plot, on top of the fence posts there (owner), or
 * on the ground where there's no post; a missing one is put back when it's
 * tended. How many it placed.
 */
async function lightFarm(middle: P3, half = FARM_HALF): Promise<number> {
  // Torches made for the spots still dark (owner: "the torches please";
  // with none on it, its field stayed dark)
  const dark = torchSpots(middle, half).filter((spot) => {
    const post = postCell(spot.x, spot.z, spot.y);
    if (!post) return false;
    const at = /_fence$/.test(knownBlock(post)?.name ?? "") ? post.offset(0, 1, 0) : post;
    return knownBlock(at)?.name !== "torch";
  }).length;
  // (from coal or torches it has, at hand or in its chests; never a trip to its mine for them)
  const { storedNear } = await import("../actions/storage");
  const fuel = ["coal", "charcoal", "torch"].some((n) => count(n) > 0 || storedNear(n) > 0);
  if (dark > count("torch") && fuel) {
    const { acquire } = await import("./acquire");
    const { liveWorld } = await import("./world");
    await acquire("torch", dark, liveWorld);
  }
  if (count("torch") === 0) return 0;
  const { placeBlockResult } = await import("../actions/blockPlacing");
  let placed = 0;
  for (const spot of torchSpots(middle, half)) {
    if (count("torch") === 0 || isCommandCancelled()) break;
    const post = postCell(spot.x, spot.z, spot.y);
    if (!post) continue;
    // On top of the post, or on the ground where there's none
    const at = /_fence$/.test(knownBlock(post)?.name ?? "") ? post.offset(0, 1, 0) : post;
    const here = knownBlock(at);
    if (here?.name === "torch") continue;
    if (here && here.name !== "air" && !CLEARABLE.test(here.name)) continue;
    if (!(await goTo(new pf.goals.GoalNear(at.x, at.y, at.z, 3))).ok) continue;
    if (here && CLEARABLE.test(here.name)) {
      const { breakBlock } = await import("../core/primitives");
      await breakBlock(at, { allowWithoutHarvest: true });
    }
    if ((await placeBlockResult("torch", at.x, at.y, at.z, "bottom")).ok) placed++;
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
    // Checked and mended like its shelter (owner: a creeper can blow a
    // crater in it): the ground made flat again, dirt in the holes
    // (not while starving: the harvest first, game test)
    const mended = (bot.food ?? 20) > 6 ? await levelPlot(farm, farm.reserve) : 0;
    if (mended > 0) chatter(`Mended my field at ${farm.x}, ${farm.z}: ${mended} block${mended === 1 ? "" : "s"} put right.`, "farm");
    const { harvestCrops } = await import("../actions/farming");
    harvested += await harvestCrops({ maxDistance: farm.half + 2, point: field });
    // Bare farmland sown again, and the plot grown outward with the seeds the
    // harvest gave; none left and the field bare: seeds from the grass round
    // about (game test: a field stood as grass, nothing sown, for an hour)
    const bare = bareCells(farm);
    if (bare > 0) {
      // Its hoe (lost in a death, it sowed nothing for hours) and its seeds from the chests
      await ensureHoe();
      for (const s of SEEDS) if (count(s) < bare) await seedsOnHand(s, bare);
    }
    if (!SEEDS.some((s) => count(s) > 0) && bare > 0 && (bot.food ?? 20) > 6) await getSeeds();
    const seed = SEEDS.find((s) => count(s) > 0);
    if (seed) await sowPlot(farm, seed, farm.half);
    // Every cell of it sown and seeds over: a ring wider (owner: 5x5, then 7x7, then 9x9)
    const grown = nextHalf(farm.half, farm.reserve, bareCells(farm));
    if (grown > farm.half && SEEDS.some((s2) => count(s2) > 0)) {
      await addPlace({ kind: "farm", name: farm.name, x: farm.x, y: farm.y, z: farm.z, details: { seed: farm.seed, half: grown, reserve: farm.reserve } });
      console.log(`Farm: ${farm.name} grows to ${2 * grown + 1} by ${2 * grown + 1}.`);
      const more = SEEDS.find((s2) => count(s2) > 0);
      if (more) await sowPlot(farm, more, grown);
    }
    await fenceField(farm, farm.reserve);
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
