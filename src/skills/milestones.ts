// Path: src/skills/milestones.ts
// The milestone list (Phase 6), replacing the two unused progression lists.
// Each milestone has a done-check computed from what the bot has right now
// (skills/capabilities: a lost pickaxe or a broken bed undoes it) and the
// steps that get it there. Tier 1 is a player's first day: wooden tools, a
// shelter, stone tools, food, a bed (spawn point set) and the shelter set up with its
// stuff put away. Later tiers are listed for Phase 7 to plan toward.

import { bot } from "../core/body";
import { describeFailure, fail, ok, type ActionResult } from "../core/result";
import { report } from "../core/narrator";
import { getMemory, updateMemory } from "../managers/persistenceManager";
import { acquire } from "./acquire";
import { liveWorld } from "./world";
import { clearAroundHome, homeCleared } from "./clearing";
import { bridgeBuilt, bridgeDone, buildBridge } from "./bridge";
import { isCommandCancelled } from "../core/commandContext";
import { bestWool, foodPoints, hasBed, RAW_FOOD, shelter, TIER, toolTier } from "./capabilities";
import { buildShelter, chestInPlace, enterShelter, placeShelterTable, setupTheShelter, shelterIntact, shelterSlots } from "../actions/building";
import { branchMine, COAL, digMine, IRON, myMine, paveMineStairs, stairsPaved, unpavedSteps } from "./mine";
import { ENDGAME_MILESTONES } from "./endgame/milestones";
import { homeLit, homeLitSeen, lightUpHome } from "./lighting";
import { farmRipe, FIELDS_WANTED, makeFarm, myFarm, myFarms, nextFieldWaits, tendFarm } from "./farm";
import { reinforceShelter, shelterSeen, shelterWeakCells } from "./reinforce";
import { dimensionNow } from "./endgame/state";
import { goTo, knownBlock, someoneIn } from "../core/primitives";
import pf from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { catalog } from "../core/catalog";
import { breakBlockAtResult } from "../actions/blockBreaking";
import { placeBlockResult } from "../actions/blockPlacing";
import { pickupNearbyItems } from "../actions/pickup";
import { daylight, workingTime } from "../core/daylight";

export type Milestone = {
  id: string;
  /** For chat: "stone tools". */
  title: string;
  tier: number;
  /** Milestones that must be done first (the owner's order: shelter, stone tools, furniture, then the mine). */
  requires?: string[];
  done: () => boolean;
  /** Gets it done (bounded; a failure says why). */
  achieve: () => Promise<ActionResult>;
  /**
   * Where it's worked on: "overworld" (the default: its shelter, its mine,
   * its first day) or "any" (the late game's, which travel between
   * dimensions themselves). In the Nether or the End an overworld milestone
   * isn't even checked (its shelter's blocks aren't there).
   */
  dimension?: "overworld" | "any";
  /**
   * Really achieved, for the announcement and the record, when `done()`
   * also means "nothing to do yet" (paved stairs with under 200 cobblestone:
   * it announced them on a new world's first minute). Defaults to `done()`.
   */
  reached?: () => boolean;
  /**
   * Worth doing in its turn, but never holding its tier up when it can't be
   * done now (it failed and waits, or what it needs isn't there): the lit
   * ground's grades and the farm. Review: a grade with a spot it could
   * never reach held the bot's whole day.
   */
  optional?: boolean;
  /**
   * A supply that gets used up (food, the stone tools, coal, torches, the
   * bucket): restocked in its turn when it runs low, but once it has been
   * reached, running low never holds its tier (and what comes after) up.
   * Review: eating below the food mark reopened the first day, froze every
   * tier above it and switched the day planner off.
   */
  supply?: boolean;
  /**
   * Low priority, like a player's chores on a quiet day: done only when
   * nothing else on its list can be done now (owner: reinforcing the
   * shelter with smooth stone ran ahead of iron, "it must be just a low
   * priority idle thing"). Never holds a tier up; the day plan can't put it
   * ahead of the rest of its tier either.
   */
  idle?: boolean;
};

/** True when a milestone can be checked and worked on in the dimension it's in now. */
export function milestoneHere(m: Milestone): boolean {
  return m.dimension === "any" || dimensionNow() === "overworld";
}

const FOOD_STOCK = 20; // food points carried: a couple of days' eating
// Hunting for the stock: only animals this close (no long trips after them)
const NEAR_HUNT = 32;
// Carrying less than this: starving (apples from leaves are worth the trouble)
// Starving with nothing near: how far it may walk for an animal (by day)
const FAR_HUNT = 150; // owner: animals scanned for 150 blocks round
// Health it needs for a walk out to a herd by day (owner: cows and pigs 50
// to 80 blocks off while it starved for an hour at home; at 14 it never
// went, as starving kept its health down). Starving, it goes whatever its health.
const WALK_HEALTH = 8;
// Food points kept in its chests at home on top of what it carries (owner:
// a reserve in the storages)
export const STORE_RESERVE = 30;
export const STARVING_FOOD = 6;
// Once stocked, eating doesn't undo it: only below half does it go hunting
// again (it announced the stock, ate while cooking, and reported "only 17")
const foodTarget = (): number => (reachedAt()["food"] ? FOOD_STOCK / 2 : FOOD_STOCK);

/** Gets each item in turn with the planner ("2 stone_pickaxe" for two); stops at the first it can't get. */
async function getAll(items: string[]): Promise<ActionResult> {
  for (const entry of items) {
    const [n, item] = /^\d+ /.test(entry) ? [Number(entry.split(" ")[0]), entry.split(" ")[1]!] : [1, entry];
    const have = bot.inventory.items().filter((i) => i.name === item).reduce((c, i) => c + i.count, 0);
    if (have >= n) continue;
    const result = await acquire(item, n, liveWorld);
    if (!result.ok) return result;
  }
  return ok();
}

/** Pickaxes it carries of at least `tier` (a spare for mining: one wears out). */
const pickaxesOfTier = (tier: number): number =>
  bot.inventory.items().filter((i) => catalog().toolKind(i.name) === "pickaxe" && catalog().toolTier(i.name) >= tier).length;

const STONE_TOOL_COST: Record<"pickaxe" | "axe" | "shovel" | "sword", { stone: number; sticks: number }> = {
  pickaxe: { stone: 3, sticks: 2 },
  axe: { stone: 3, sticks: 2 },
  shovel: { stone: 1, sticks: 2 },
  sword: { stone: 2, sticks: 1 },
};
const TOOL_STONE = /^(cobblestone|cobbled_deepslate|blackstone)$/;

/**
 * True when what it carries makes the stone tools it still lacks (stone,
 * sticks or wood for them, and planks for its shelter's table if it has
 * none): work for the night in its shelter, no trip out (game test: no stone
 * tools yet at dusk, so no furnishing, and it stood in its room all night).
 */
export function stoneToolsFromBag(): boolean {
  const items = bot.inventory.items();
  const count = (test: (name: string) => boolean): number => items.filter((i) => test(i.name)).reduce((n, i) => n + i.count, 0);
  let stone = 0;
  let sticks = 0;
  const lack = (["axe", "shovel", "sword"] as const).filter((k) => toolTier(k) < TIER.stone);
  const picks = Math.max(0, 2 - pickaxesOfTier(TIER.stone));
  for (const k of lack) {
    stone += STONE_TOOL_COST[k].stone;
    sticks += STONE_TOOL_COST[k].sticks;
  }
  stone += picks * STONE_TOOL_COST.pickaxe.stone;
  sticks += picks * STONE_TOOL_COST.pickaxe.sticks;
  if (stone === 0) return false; // nothing to make
  const slots = shelterSlots();
  const tablePlanks = slots?.table && knownBlock(slots.table)?.name !== "crafting_table" && count((n) => n === "crafting_table") === 0 ? 4 : 0;
  // In stick-sized pieces: a plank makes 2 sticks, a log 4 planks
  const wood = count((n) => n === "stick") + 2 * count((n) => catalog().isPlanks(n)) + 8 * count((n) => catalog().isLog(n));
  return count((n) => TOOL_STONE.test(n)) >= stone && wood >= sticks + 2 * tablePlanks;
}

/** Food: berries, then hunting, then cooking what it caught. */
export async function stockFood(options: { emergency?: boolean } = {}): Promise<ActionResult> {
  // Starving is starving whoever asked: the day plan's food step too may go
  // further for animals (game test: the plan's step only picked leaves again)
  const emergency = options.emergency || (bot.food ?? 20) <= 6;
  const { pickBerries } = await import("../commands/StarterKit");
  const { execute: hunt } = await import("../commands/Hunting");
  const { cookFood } = await import("../actions/cooking");
  const { collectFromOvens, cookingFoodPoints } = await import("../actions/cooking");
  // Food it left cooking counts, unless it's hungry now (then it's taken out first)
  const short = (): boolean => foodPoints() + (hungryNow() ? 0 : cookingFoodPoints()) < FOOD_STOCK && !isCommandCancelled();
  const byDay = daylight;
  // What's done in a furnace it left cooking comes out first (all of what's
  // ready when hungry)
  await collectFromOvens(hungryNow());
  // Owner: a stock of cooked food, and hunting isn't a way to keep one (it
  // walked 100-plus blocks after single sheep and chickens, through caves,
  // and died). Lasting sources first, in this order:
  // 1. cooked food in its own chests; raw meat and fish (carried or stored) cooked
  await foodFromChests();
  if (short() && hasRawFood()) await cookTheMeat(cookFood);
  // Hungry (its own hunger, or next to nothing to eat): food it can eat
  // soon, nothing that only feeds it later (game test: starving, it broke
  // grass for seeds for 6 minutes to make a farm, then 107 oak leaves for
  // no apple, and starved to death without ever going for the animals near)
  if (hungryNow()) {
    if (short() && myFarm() && farmRipe() > 0) await tendFarm();
    if (short()) await pickBerries();
    if (short()) await cocoaAndCookies();
    if (short()) await wildFood();
    if (short()) await hunt({ maxDistance: NEAR_HUNT, mobType: null, count: 4, upTo: null, walkFar: false });
    // Starving with nothing near (game test: it starved twice, no animal
    // within 32): by day the walk may go further, to animals out under the
    // sky up to FAR_HUNT away; dying of hunger is the bigger risk
    if (emergency && foodPoints() === 0 && !hasRawFood() && byDay() && !isCommandCancelled()) {
      const { knownAnimals } = await import("../actions/hunting");
      const { isGame } = await import("../actions/hunting");
      // The one it would walk to (the nearest it would really take) within reach
      const near = knownAnimals().filter((p) => isGame(p, null))[0];
      const goFar = near !== undefined && near.distance <= FAR_HUNT;
      if (goFar) await huntTheHerd(true, hunt);
      // None known at all (game test: "0 in sight or earshot", starving):
      // it walks off to look, a few legs out, and hunts what it finds
      else {
        const { exploreFor, animalsInSight, ANIMAL_WALK } = await import("./explore");
        if (await exploreFor("animals", animalsInSight, 3, ANIMAL_WALK / 3)) await hunt({ maxDistance: NEAR_HUNT, mobType: null, count: 3, upTo: null, walkFar: true });
      }
    }
    if (hasRawFood()) await cookTheMeat(cookFood);
    if (short()) {
      const { goFishing } = await import("./fishing");
      if ((await goFishing()) > 0) await cookTheMeat(cookFood);
    }
    // Apples from oak leaves: off (owner, 2026-11-27: breaking leaves isn't
    // productive; one leaf in 200 drops an apple, and it eats rotten flesh now)
    // if (foodPoints() < STARVING_FOOD && byDay() && !isCommandCancelled()) {
    //   const { applesFromLeaves } = await import("./apples");
    //   await applesFromLeaves();
    // }
  }
  // Fed: the lasting sources. Its farm tended, or made now (a bucket, by day)
  if (short() && myFarm()) await tendFarm();
  if (short() && myFarms().length < FIELDS_WANTED && byDay() && !hungryNow()) {
    const made = await makeFarm();
    if (!made.ok) console.log(`Food: no farm yet (${describeFailure(made)}).`);
  }
  // Berries, cocoa (cookies with wheat); fishing (a rod, or string for one, and open water near)
  if (short()) await pickBerries();
  if (short()) await cocoaAndCookies();
  if (short()) await wildFood();
  if (short()) {
    const { goFishing } = await import("./fishing");
    if ((await goFishing()) > 0) await cookTheMeat(cookFood);
  }
  // Last: animals close by (no exploring for them); by day, one it knows of
  // out under the sky within RESTOCK_HUNT too (game test: pigs 47 blocks off,
  // the restock hunted only within 32, and it sat with no food, refusing
  // the mine)
  if (short()) await hunt({ maxDistance: NEAR_HUNT, mobType: null, count: null, upTo: huntCount(await stockShortfall()), walkFar: false });
  // The herds it knows of, by day: enough for its stock and the reserve at home
  if ((short() || (await stockShortfall()) > 0) && !hasRawFood() && byDay() && !isCommandCancelled()) await huntTheHerd(emergency, hunt);
  if (hasRawFood()) await cookTheMeat(cookFood);
  // What's over its carried stock goes in its chests at home: the reserve
  await storeFoodReserve();
  return foodPoints() >= foodTarget() ? ok() : fail("missing_items", `only ${foodPoints()} food points ready to eat; nothing more near home today`);
}

/** Food points short of its carried stock and the reserve in its chests near home (as last seen). */
async function stockShortfall(): Promise<number> {
  const { storedNear } = await import("../actions/storage");
  const foods = (bot.registry.foodsByName ?? {}) as Record<string, { foodPoints?: number }>;
  const stored = READY_FOOD.reduce((n, name) => n + (foods[name]?.foodPoints ?? 2) * storedNear(name, 32), 0);
  return Math.max(0, FOOD_STOCK + STORE_RESERVE - foodPoints() - stored);
}

/**
 * Animals to take for `need` food points: about 6 a head once cooked (a cow
 * or a pig 8 or more, a chicken or a sheep 6 or less), at least 3, at most
 * 10 in one go. Pure.
 */
export function huntCount(need: number): number {
  return Math.max(3, Math.min(10, Math.ceil(need / 6)));
}

/**
 * Whether to walk out to the animals it knows of: by day, the nearest within
 * FAR_HUNT, two or more animals together there (`herd`) unless it's
 * starving (owner: not 100 blocks after one chicken), and fit enough for the walk (starving it goes anyway: hunger
 * takes its health down too). Pure.
 */
export function walkToHerd(nearest: number | null, herd: number, health: number, starving: boolean): boolean {
  if (nearest === null || nearest > FAR_HUNT) return false;
  if (nearest > NEAR_HUNT && herd < 2 && !starving) return false;
  return starving || health >= WALK_HEALTH;
}

/** Out to the herd it knows of, hunting enough for its stock and reserve (leaving a pair of each kind). */
async function huntTheHerd(emergency: boolean, hunt: (args: Record<string, unknown>) => Promise<unknown>): Promise<void> {
  const { knownAnimals, isGame } = await import("../actions/hunting");
  const game = knownAnimals().filter((p) => isGame(p, null));
  const first = game[0];
  const at = first ? bot.entities[first.id]?.position : undefined;
  // The animals round the nearest one (it takes them all: no breeding pairs
  // left in the wild, owner)
  const there = at ? game.filter((p) => bot.entities[p.id]?.position && bot.entities[p.id]!.position.distanceTo(at) <= 32) : [];
  const herd = there.length;
  const starving = emergency || (bot.food ?? 20) <= STARVING_FOOD;
  // None within 150 blocks (owner): a walk of up to 75 in one direction over
  // dry land to look, then the hunt there
  if (!first && (starving || (bot.health ?? 20) >= WALK_HEALTH)) {
    const { exploreFor, animalsInSight, ANIMAL_WALK } = await import("./explore");
    if (!(await exploreFor("animals", animalsInSight, 3, ANIMAL_WALK / 3))) return;
    return huntTheHerd(emergency, hunt);
  }
  if (!walkToHerd(first?.distance ?? null, herd, bot.health ?? 20, starving)) {
    if (first) console.log(`Food: not walking to the ${first.name} ${Math.round(first.distance)} blocks off (${herd} there, health ${Math.round(bot.health ?? 0)}).`);
    return;
  }
  const count = huntCount(await stockShortfall());
  console.log(`Food: out to the ${herd > 1 ? "herd" : first!.name} ${Math.round(first!.distance)} blocks off for ${count} animals (a stock and a reserve at home).`);
  await hunt({ maxDistance: NEAR_HUNT, mobType: null, count: null, upTo: count, walkFar: true });
}

/**
 * Food over its carried stock put in its own chests at home (owner: a
 * reserve in the storages; it takes from them when it runs short). The best
 * food stays on it. Only at home, never raw meat (cooked first).
 */
export async function storeFoodReserve(): Promise<void> {
  const foods = (bot.registry.foodsByName ?? {}) as Record<string, { foodPoints?: number }>;
  const carried = READY_FOOD.map((name) => ({ name, count: carriedOf([name]), points: foods[name]?.foodPoints ?? 2 })).filter((f) => f.count > 0);
  const keep = foodToKeep(carried, FOOD_STOCK);
  const over = carried.reduce((n, f) => n + (f.count - (keep[f.name] ?? 0)), 0);
  if (over === 0) return;
  const home = shelterSlots();
  const spot = home?.chests.find((c) => knownBlock(new Vec3(c.x, c.y, c.z))?.name.endsWith("chest")) ?? null;
  if (!home || !spot) return;
  if (!(await goTo(new pf.goals.GoalNear(spot.x, spot.y, spot.z, 2))).ok) return;
  const { depositAt } = await import("../actions/storage");
  const put = await depositAt(spot, (name) => name in keep, keep);
  if (put.stored > 0) report(`Put ${put.stored} food in my chests at home as a reserve.`);
  else if (put.problem) console.log(`Food: couldn't store the reserve: ${put.problem}.`);
}

/**
 * How many of each food it keeps on it: the best first, until `points` of
 * eating; the rest goes in its chests. Pure.
 */
export function foodToKeep(carried: Array<{ name: string; count: number; points: number }>, points: number): Record<string, number> {
  const keep: Record<string, number> = {};
  let left = points;
  for (const f of [...carried].sort((a, b) => b.points - a.points)) {
    const n = left > 0 ? Math.min(f.count, Math.ceil(left / f.points)) : 0;
    keep[f.name] = n;
    left -= n * f.points;
  }
  return keep;
}

// Its hunger bar this low (of 20) counts as hungry: it can't heal under 18,
// can't sprint at 6
const HUNGRY_BAR = 14;

/** Hungry now: its hunger bar low, or next to nothing ready to eat on it. */
export function isHungry(bar: number, points: number): boolean {
  return bar <= HUNGRY_BAR || points < STARVING_FOOD;
}
const hungryNow = (): boolean => isHungry(bot.food ?? 20, foodPoints());

/**
 * Ripe cocoa pods off the jungle trees round about (owner), and cookies
 * from them with its wheat: 2 wheat and a cocoa bean make 8.
 */
async function cocoaAndCookies(): Promise<void> {
  const { harvestCrops } = await import("../actions/farming");
  const picked = await harvestCrops({ only: ["cocoa"], maxDistance: 24 });
  if (picked > 0) console.log(`Food: picked ${picked} cocoa pods.`);
  const beans = carriedOf(["cocoa_beans"]);
  const wheat = carriedOf(["wheat"]);
  const batches = Math.min(beans, Math.floor(wheat / 2));
  if (batches === 0) return;
  const { acquire } = await import("./acquire");
  const { liveWorld } = await import("./world");
  const made = await acquire("cookie", carriedOf(["cookie"]) + batches * 8, liveWorld);
  if (made.ok) console.log(`Food: baked ${batches * 8} cookies.`);
}

// How far it goes for wild melons and mushrooms
const WILD_RANGE = 32;

/**
 * Wild food round about (owner): melons broken into slices, and brown and
 * red mushrooms picked and cooked with a bowl into mushroom stew (a bowl
 * from planks; the stew is a good meal, 6 food).
 */
async function wildFood(): Promise<void> {
  const { harvestCrops } = await import("../actions/farming");
  const melons = await harvestCrops({ only: ["melon"], maxDistance: WILD_RANGE });
  if (melons > 0) console.log(`Food: broke ${melons} wild melons into slices.`);
  // Mushrooms: one of each kind per stew
  const { collectBlock } = await import("../actions/collectBlock");
  for (const kind of ["brown_mushroom", "red_mushroom"]) {
    if (carriedOf([kind]) < 2 && !isCommandCancelled()) await collectBlock(kind, 2 - carriedOf([kind]), WILD_RANGE, { seenOnly: true });
  }
  const stews = Math.min(carriedOf(["brown_mushroom"]), carriedOf(["red_mushroom"]));
  if (stews === 0) return;
  const { acquire } = await import("./acquire");
  const { liveWorld } = await import("./world");
  const made = await acquire("mushroom_stew", carriedOf(["mushroom_stew"]) + stews, liveWorld);
  if (made.ok) console.log(`Food: made ${stews} mushroom stew.`);
}

/** True when it carries raw meat or fish. */
const hasRawFood = (): boolean => bot.inventory.items().some((i) => RAW_FOOD.has(i.name));

// Ready food worth taking out of its chests, best first, and raw food to cook
const READY_FOOD = ["cooked_beef", "cooked_porkchop", "cooked_mutton", "golden_carrot", "cooked_salmon", "cooked_chicken", "baked_potato", "cooked_rabbit", "bread", "cooked_cod", "pumpkin_pie", "apple", "carrot", "melon_slice", "sweet_berries"];

/** Ready food from its own chests near home, then raw food to cook, until the stock is full. */
export async function foodFromChests(): Promise<void> {
  const { storedNear, takeItems } = await import("../actions/storage");
  const foods = (bot.registry.foodsByName ?? {}) as Record<string, { foodPoints?: number }>;
  for (const name of [...READY_FOOD, ...RAW_FOOD]) {
    const short = FOOD_STOCK - foodPoints();
    if (short <= 0 || isCommandCancelled()) return;
    const stored = storedNear(name, 32);
    if (stored === 0) continue;
    const per = foods[name]?.foodPoints ?? 2;
    const take = Math.min(stored, Math.ceil(short / per) + (RAW_FOOD.has(name) ? 2 : 0));
    const got = await takeItems([{ name, count: take }], true);
    const n = got?.taken.get(name) ?? 0;
    if (n > 0) console.log(`Food: took ${n} ${name.replace(/_/g, " ")} from my chests.`);
  }
}

/**
 * Raw meat cooked like a player: in its shelter's furnace (walking home from
 * the hunt), with coal or wood from its chests when it carries no fuel. A
 * furnace of its own only without one at home, and never without fuel (80
 * blocks out it made a table and a furnace, then had nothing to burn).
 */
async function cookTheMeat(cookIt: (only: string | null, limit: number, leave: boolean) => Promise<number | null>): Promise<void> {
  // Not hungry: the furnace is loaded and left, and it gets on with its
  // restock (owner: not standing by the furnace); hungry, it waits for the food
  const leave = !hungryNow();
  const cookFood = (): Promise<number | null> => cookIt(null, 64, leave);
  if ((await cookFood()) !== null) return;
  const { carriesFuel } = await import("../actions/cooking");
  const home = shelterSlots()?.furnace;
  if (home) {
    const there = await goTo(new pf.goals.GoalNear(home.x, home.y, home.z, 2));
    if (!there.ok || isCommandCancelled()) return;
    if (!carriesFuel()) {
      const { storedNear, takeItems } = await import("../actions/storage");
      const fuel = ["coal", "charcoal", "logs"].find((f) => storedNear(f, 32) > 0);
      if (fuel) await takeItems([{ name: fuel, count: fuel === "logs" ? 6 : 4 }], true);
    }
    if ((await cookFood()) !== null || knownBlock(home)?.name === "furnace") return;
  }
  if (!carriesFuel()) return;
  if ((await acquire("furnace", 1, liveWorld)).ok) await cookFood();
}

type Cell = { x: number; y: number; z: number };

/**
 * The cells its bed needs free: the foot (its slot), the head one further on
 * from where it's placed from, and that stand (the table's spot), where it
 * stands to place it. Pure.
 */
export function bedCells(slot: Cell, stand: Cell | null): Cell[] {
  if (!stand) return [slot];
  const head = { x: 2 * slot.x - stand.x, y: slot.y, z: 2 * slot.z - stand.z };
  return [slot, head, stand];
}

/** A bed: 3 wool of one colour (from sheep), crafted, put in its slot in the shelter, used (spawn point). */
async function getBed(): Promise<ActionResult> {
  if (!bot.inventory.items().some((i) => i.name.endsWith("_bed"))) {
    let wool = bestWool();
    // One more wool at a time, the colour chosen again each time: any colour
    // reaching 3 makes the bed (game test: a tie of 1 brown and 1 white
    // picked brown, and it hunted on for brown with 4 white in its pocket)
    for (let tries = 0; (!wool || wool[1] < 3) && tries < 6 && !isCommandCancelled(); tries++) {
      // More of the colour it has most of; white on a tie (most sheep are white)
      const colour = wool?.[0] ?? "white";
      const got = await acquire(`${colour}_wool`, (wool?.[1] ?? 0) + 1, liveWorld);
      wool = bestWool();
      if (!got.ok && (!wool || wool[1] < 3)) {
        console.log(`Bed: no more ${colour} wool (${describeFailure(got)}); best is ${wool ? `${wool[1]} ${wool[0]}` : "none"}.`);
        return fail("missing_items", `I need 3 wool of one colour for a bed (${describeFailure(got)})`);
      }
    }
    if (!wool || wool[1] < 3) return fail("missing_items", "I need 3 wool of one colour for a bed");
    const made = await acquire(`${wool![0]}_bed`, 1, liveWorld);
    if (!made.ok) return made;
  }
  // In the shelter, in the bed's own spot (never the nearest bed: that may be the owner's)
  const inside = await enterShelter();
  if (!inside.ok) return inside;
  const slots = shelterSlots();
  const slot = slots?.bed;
  if (!slot) return fail("not_found", "no spot for a bed in the shelter");
  if (!catalog().isBed(knownBlock(slot)?.name ?? "")) {
    const bedItem = bot.inventory.items().find((i) => i.name.endsWith("_bed"));
    if (!bedItem) return fail("missing_items", "no bed to put down");
    // Placed facing on from the cell behind it (the table's spot), so the
    // head goes along the wall; a table already there is moved for a moment.
    // Someone in the bed's two cells or the table's spot first: nothing is
    // touched (overnight test: the owner's AFK character stood on the bed's
    // spot, the table was broken for nothing and dropped by the owner, who
    // picked it up, and the shelter stood unfurnished for hours)
    const blocker = someoneIn(bedCells(slot, slots?.bedStand ?? null));
    if (blocker) return fail("occupied", `${blocker} is standing where my bed goes`);
    let tableMoved = false;
    if (slots?.bedStand) {
      if (knownBlock(slots.bedStand)?.name === "crafting_table") {
        tableMoved = (await breakBlockAtResult(slots.bedStand.x, slots.bedStand.y, slots.bedStand.z)).ok;
        if (tableMoved) await pickupNearbyItems(bot, 3);
      }
      const there = await goTo(new pf.goals.GoalBlock(slots.bedStand.x, slots.bedStand.y, slots.bedStand.z));
      if (!there.ok) console.log(`Couldn't stand behind the bed's spot (${describeFailure(there)}); placing it from here.`);
    }
    const placed = await placeBlockResult(bedItem.name, slot.x, slot.y, slot.z);
    if (tableMoved && slots?.bedStand) {
      // Back in its spot, from its row, whether the bed went down or not;
      // a table made again if the dropped one is gone (picked up by someone)
      const back = await placeShelterTable();
      if (!back.ok) console.log(`Couldn't put the shelter's table back (${describeFailure(back)}); the shelter set-up will.`);
    }
    if (!placed.ok) return placed;
  }
  const { execute: sleep } = await import("../commands/Sleep");
  await sleep({ newBed: false }); // its new bed is the nearest: uses it (by day too), so the spawn point is set
  // Lying in it to set the spawn point in the evening: back up while it's
  // working time (owner: it works at night until it's attacked)
  if (bot.isSleeping && workingTime()) await (await import("../core/primitives")).wakeUp();
  return hasBed() ? ok() : fail("refused", "the bed didn't take (the server said no)");
}

/** The shelter furnished (the owner's setupTheShelter), with the cheap stuff put away. */
async function furnishShelter(): Promise<ActionResult> {
  const set = await setupTheShelter();
  if (!set.ok) return set;
  const { lookInChest, storeItems } = await import("../actions/storage");
  const first = shelterSlots()?.chests[0];
  const chest = first ? knownBlock(first) : null;
  if (chest?.name === "chest") await lookInChest(chest); // remembered from now on
  await storeItems("half");
  return furnished() ? ok() : fail("refused", "the chests, furnace or table didn't stay");
}

/** Every spot in the shelter has its chest, furnace and table. */
function furnished(): boolean {
  const slots = shelterSlots();
  if (!slots) return false;
  const has = (spot: { x: number; y: number; z: number } | null, name: string): boolean => !spot || knownBlock(spot)?.name === name || !knownBlock(spot);
  // The shelter always has its own table (owner: one outside and one inside is fine)
  const table = has(slots.table, "crafting_table");
  // Chests facing the middle (a wrong-facing pair never joins into a double chest)
  const chests = slots.chests.every((c) => !knownBlock(c) || (slots.direction ? chestInPlace(c, slots.stand, slots.direction) : has(c, "chest")));
  return chests && has(slots.furnace, "furnace") && table;
}

/** Every milestone, in the order the bot goes for them. */
export const MILESTONES: Milestone[] = [
  {
    id: "wooden_tools",
    title: "wooden tools",
    tier: 1,
    // A player's first set: dirt everywhere wants a shovel, trees an axe
    // Once it has had stone tools, never back to wood: worn-out tools are
    // remade as stone (or iron) by the stone tools milestone (owner: it made
    // wooden tools again after its pickaxes broke in the mine)
    done: () => Boolean(reachedAt()["stone_tools"]) || (["pickaxe", "axe", "shovel", "sword"] as const).every((k) => toolTier(k) >= TIER.wooden),
    achieve: () => getAll(["wooden_pickaxe", "wooden_axe", "wooden_shovel", "wooden_sword"]),
  },
  {
    id: "shelter",
    title: "a shelter",
    tier: 1,
    // Whole as the plan says now (walls, roof, floor, both doors): a creeper's
    // hole or a newer plan (the mine door) makes it not done, and it's mended
    done: () => shelter() !== null && shelterIntact(),
    achieve: () => buildShelter(),
  },
  {
    id: "stone_tools",
    title: "stone tools",
    tier: 1,
    supply: true,
    requires: ["shelter"],
    // Two pickaxes: mining wears one out
    done: () => (["axe", "shovel", "sword"] as const).every((k) => toolTier(k) >= TIER.stone) && pickaxesOfTier(TIER.stone) >= 2,
    achieve: async () => {
      // At night (from what it carries, see stoneToolsFromBag): the
      // shelter's own table first, so it crafts inside, not at one outside
      if (!daylight() && shelter()) {
        const table = await placeShelterTable();
        if (!table.ok) return table;
      }
      return getAll(["2 stone_pickaxe", "stone_axe", "stone_shovel", "stone_sword"]);
    },
  },
  {
    id: "chests",
    title: "my shelter set up (chests, furnace, table)",
    tier: 1,
    requires: ["shelter", "stone_tools"],
    done: () => shelter() !== null && furnished(),
    achieve: furnishShelter,
  },
  {
    id: "bed",
    title: "a bed",
    tier: 1,
    requires: ["chests"],
    done: hasBed,
    achieve: getBed,
  },  // Owner (2026-11-27): in the woods, the trees round the shelter cut down
  // (shade where mobs hide by day; and wood), once its shelter is furnished
  // and has a bed (owner: furnishing the shelter is a strict procedure,
  // right after its stone tools)
  {
    id: "clearing",
    title: "a clearing round my home",
    tier: 1,
    optional: true,
    requires: ["shelter", "stone_tools"],
    // (no home yet: not done, it waits for the shelter; game test: "done:
    // a clearing round my home" before it had one)
    done: () => shelter() !== null && homeCleared(),
    achieve: clearAroundHome,
  },
  // Owner (2026-11-27): after stone tools, at least 20 logs on hand (planks,
  // sticks, a table, chests, charcoal) before the shelter's furniture
  {
    id: "wood_stock",
    title: "a stock of wood",
    tier: 1,
    supply: true,
    requires: ["stone_tools"],
    done: () => carriedOf(LOG_NAMES()) >= WOOD_STOCK,
    achieve: () => acquire("logs", WOOD_STOCK, liveWorld),
  },
  {
    id: "lit_home",
    title: "a lit home",
    // Day one (owner: it's critical): mobs kept coming at the shelter
    // because nothing round it was lit. Torches on the room's walls and in a
    // grid on the ground round it (by day), made from coal or, before it has
    // any, charcoal from logs in its furnace; put back when a creeper knocks
    // them out
    tier: 1,
    // Skippable when it can't be done now (owner, 2026-11-27): never holds up the mine
    optional: true,
    requires: ["chests"],
    done: () => shelter() !== null && homeLit(),
    achieve: () => lightUpHome(workingTime()),
    reached: () => shelter() !== null && homeLitSeen(0),
  },

  {
    id: "food",
    title: "a food stock",
    tier: 1,
    supply: true,
    // Skippable (owner): it eats what it finds, rotten flesh too, rather than starve
    optional: true,
    requires: ["chests"],
    done: () => foodPoints() >= foodTarget(),
    achieve: stockFood,
  },
  // --- Tier 2: the mine under the shelter (owner's design) -----------------------
  {
    id: "mine",
    title: "a mine",
    tier: 2,
    requires: ["stone_tools", "chests"],
    done: () => myMine() !== null,
    achieve: digMine,
  },
  // Its first field, once the mine is started (owner, 2026-11-27: the
  // shelter furnished and a bed come first; fields are never given up, but
  // never hold up the mine either). Wheat from the grass's seeds is a good
  // source of food; water goes in its middle once it has a bucket. By day
  {
    id: "farm",
    title: "my first field",
    tier: 2,
    optional: true,
    requires: ["shelter"],
    // Waiting for seeds is "not yet": nothing to do now, no failure
    done: () => myFarms().length >= 1 || nextFieldWaits((n) => owned([n])),
    reached: () => myFarms().length >= 1,
    achieve: makeFarm,
  },
  {
    id: "coal",
    title: "coal",
    tier: 2,
    supply: true,
    requires: ["mine"],
    // Torches and smelting use it up: once found, only below 4 does it go back for more
    done: () => carriedOf(COAL.counts) >= (reachedAt()["coal"] ? 4 : COAL.enough),
    // Coal put away at home first, the mine only if that's not enough (review)
    achieve: async () => {
      const short = (reachedAt()["coal"] ? 4 : COAL.enough) - carriedOf(COAL.counts);
      const { storedNear, takeItems } = await import("../actions/storage");
      if (short > 0 && storedNear("coal", 32) > 0) await takeItems([{ name: "coal", count: Math.max(short, COAL.enough - carriedOf(COAL.counts)) }], true);
      if (carriedOf(COAL.counts) >= (reachedAt()["coal"] ? 4 : COAL.enough)) return ok();
      // Its mine dry of coal for a while and plenty of wood: charcoal
      // (owner); at night with no spare logs at hand, the mine after all
      const { makeCharcoalNow, makeCharcoal, coalTripStart, coalTripEnd } = await import("./coalDrought");
      if (makeCharcoalNow()) {
        const made = await makeCharcoal(COAL.enough - carriedOf(COAL.counts));
        if (made.ok) return carriedOf(COAL.counts) >= (reachedAt()["coal"] ? 4 : COAL.enough) ? ok() : made;
        console.log(`Coal: no charcoal this time (${describeFailure(made)}); down my mine.`);
      }
      const start = coalTripStart();
      try {
        return await branchMine([COAL, IRON]);
      } finally {
        await coalTripEnd(start);
      }
    },
  },
  {
    id: "torches",
    title: "torches",
    tier: 2,
    supply: true,
    requires: ["coal"],
    // A player lights the way down before going deep (a skeleton in its dark
    // stairs, mobs spawning in its tunnels): 16 made, and topped up below 8
    done: () => carriedOf(["torch"]) >= (reachedAt()["torches"] ? TORCHES_LOW : TORCHES),
    achieve: () => getAll([`${TORCHES} torch`]),
  },
  {
    id: "paved_stairs",
    title: "paved mine stairs",
    tier: 2,
    optional: true,
    idle: true,
    requires: ["mine"],
    // Owner: once 200 cobblestone have piled up, the mine's stairs get
    // cobblestone stair blocks (and a block more headroom); until then (or
    // with every step paved) there's nothing to do. In the mine stage,
    // needing only the mine: behind the iron pickaxe and the iron armour it
    // never came up, and it walked bare steps with over 1,400 cobblestone
    // in its chests (owner)
    done: () => cobblestoneOwned() < PAVE_AFTER || unpavedSteps().length === 0,
    reached: () => stairsPaved(),
    achieve: paveMineStairs,
  },
  // More fields, up to its 4 (owner: a low-priority job, after everything else)
  {
    id: "more_fields",
    title: "more fields",
    tier: 2,
    optional: true,
    idle: true,
    requires: ["farm"],
    done: () => myFarms().length >= FIELDS_WANTED || nextFieldWaits((n) => owned([n])),
    reached: () => myFarms().length >= FIELDS_WANTED,
    achieve: makeFarm,
  },
  // Owner (2026-11-27): a bridge over the river by its home, where it swims
  // across (twice or more) or its field is over the water; mended after a
  // creeper. Low priority, by day (skills/bridge)
  {
    id: "bridge",
    title: "a bridge over the river by my home",
    tier: 2,
    optional: true,
    idle: true,
    requires: ["mine"],
    done: bridgeDone,
    // Nothing to do yet isn't a bridge (it said "Milestone: a bridge" on joining)
    reached: bridgeBuilt,
    achieve: buildBridge,
  },
  // Owner: the shelter's weak walls (dirt and sand blow out; stone holds
  // against a creeper) changed for smooth stone, a low-priority job, only
  // with two stacks of coal and smooth stone already made (the workshop makes
  // it in the background). Nothing to do before then ("not yet", no failure),
  // or when it's all strong. Its walls must be in sight to count as strong
  // (from far away they aren't loaded and read as "nothing weak": it was
  // marked reached before any reinforcing)
  {
    id: "stone_shelter",
    title: "a smooth stone shelter",
    tier: 2,
    optional: true,
    idle: true,
    requires: ["mine"],
    done: () => shelter() !== null && (!readyToReinforce() || (shelterSeen() && shelterWeakCells().length === 0)),
    reached: () => shelter() !== null && shelterSeen() && shelterWeakCells().length === 0,
    achieve: () => reinforceShelter(workingTime()),
  },
  {
    id: "iron",
    title: "iron",
    tier: 2,
    requires: ["mine"],
    // Made into tools later: found once is reached
    done: () => Boolean(reachedAt()["iron"]) || carriedOf(IRON.counts) >= IRON.enough,
    achieve: () => branchMine([IRON, COAL]),
  },
  {
    id: "iron_pickaxe",
    title: "an iron pickaxe",
    tier: 2,
    requires: ["iron"],
    done: () => toolTier("pickaxe") >= TIER.iron,
    achieve: smeltIronAndMakePickaxe,
  },

  // --- Tier 3: iron and diamonds (a player's next steps) ----------------------
  // First iron goes to safety, the way a player spends it: a shield (one
  // ingot: arrows and creeper blasts), a water bucket (lava, fire, falls; the
  // portal's obsidian later), armour; then the other tools. Game test: it
  // went down to y=-53 in a leather chestplate with stone tools and died in
  // lava and to a zombie.
  // An iron sword first of all (two ingots: it fights what it meets on the
  // way to the rest with it, review)
  {
    id: "iron_sword",
    title: "an iron sword",
    tier: 3,
    requires: ["iron_pickaxe"],
    done: () => toolTier("sword") >= TIER.iron,
    achieve: () => makeFromIron([["iron_sword", 2]]),
  },
  {
    id: "shield",
    title: "a shield",
    tier: 3,
    dimension: "any",
    requires: ["iron_pickaxe"],
    done: () => owns("shield"),
    achieve: async () => {
      const made = await makeFromIron([["shield", 1]]);
      if (!made.ok) return made;
      const { equipItem } = await import("../core/primitives");
      await equipItem("shield", "off-hand");
      return ok();
    },
  },
  {
    id: "bucket",
    title: "a water bucket",
    tier: 3,
    supply: true,
    dimension: "any",
    requires: ["iron_pickaxe"],
    // Any bucket counts (it pours the water out for obsidian and takes it back)
    done: () => owns("bucket") || owns("water_bucket") || owns("lava_bucket"),
    achieve: async () => {
      const made = await makeFromIron([["bucket", 3]]);
      if (!made.ok) return made;
      // Filled where there's water in sight (by day: at night that may be
      // out in the open); an empty one is filled later
      if (!workingTime()) return ok();
      const { fillWater } = await import("./endgame/portal");
      const filled = await fillWater(true); // out in the open: never dug down to water under ground
      if (!filled.ok) console.log(`Bucket: not filled yet (${describeFailure(filled)}).`);
      return ok();
    },
  },
  {
    id: "iron_armor",
    title: "iron armor",
    tier: 3,
    requires: ["iron_pickaxe"],
    done: () => IRON_ARMOR.every(([piece]) => owns(piece)),
    // Piece by piece (review: it waited for all 24 ingots before wearing
    // any): what the iron it has affords is made and worn first, best piece
    // first; then one trip down for the rest
    achieve: async () => {
      const { equipItem } = await import("../core/primitives");
      const wear = async (): Promise<void> => {
        for (const [piece, , slot] of IRON_ARMOR) if (carriedOf([piece]) > 0) await equipItem(piece, slot);
      };
      const { storedNear } = await import("../actions/storage");
      const iron = (): number => carriedOf(["iron_ingot", "raw_iron"]) + storedNear("iron_ingot", 32) + storedNear("raw_iron", 32);
      for (const [piece, n] of armorPiecesNow(iron(), owns)) {
        if (isCommandCancelled()) return fail("aborted", "stopped");
        if (iron() < n) continue;
        if ((await makeFromIron([[piece, n]])).ok) await wear();
      }
      const made = await makeFromIron(IRON_ARMOR.map(([piece, n]) => [piece, n]));
      await wear();
      return made;
    },
  },
  // The lit ground round its home, further out (owner: in grades, each once
  // the one before is done; by day)
  {
    id: "lit_home_2",
    title: "my home lit twice as far",
    tier: 3,
    optional: true,
    idle: true,
    requires: ["lit_home"],
    done: () => shelter() === null || homeLit(1),
    achieve: () => lightUpHome(workingTime(), 1),
    reached: () => shelter() !== null && homeLitSeen(1),
  },
  {
    id: "iron_tools",
    title: "iron tools",
    tier: 3,
    requires: ["iron_pickaxe"],
    done: () => (["sword", "axe", "shovel"] as const).every((k) => toolTier(k) >= TIER.iron),
    achieve: () => makeFromIron([["iron_sword", 2], ["iron_axe", 3], ["iron_shovel", 1]]),
  },
  {
    id: "lit_home_3",
    title: "my home lit three times as far",
    tier: 3,
    optional: true,
    idle: true,
    requires: ["lit_home_2"],
    done: () => shelter() === null || homeLit(2),
    achieve: () => lightUpHome(workingTime(), 2),
    reached: () => shelter() !== null && homeLitSeen(2),
  },
  {
    id: "diamonds",
    title: "diamonds",
    tier: 3,
    // Deep down there's lava and more mobs: a shield, a water bucket and iron
    // armour first (review: the plan could send it after diamonds without them)
    requires: ["iron_pickaxe", "shield", "bucket", "iron_armor"],
    // Deep in the mine: its hubs go 20 steps deeper each time all three tunnels are done
    // Diamonds in its chests count (it puts half its valuables away at home)
    done: () => owned(["diamond"]) >= DIAMONDS || toolTier("pickaxe") >= TIER.diamond,
    achieve: () => mineDiamonds(DIAMONDS),
  },
  {
    id: "diamond_pickaxe",
    title: "a diamond pickaxe",
    tier: 3,
    requires: ["diamonds"],
    done: () => toolTier("pickaxe") >= TIER.diamond,
    achieve: () => makeDiamondGear("diamond_pickaxe"),
  },
  // The diamond gear after the pickaxe, in the order a player makes it: the
  // sword, then the armour, the chestplate first (it stops the most damage).
  // The Nether waits for the sword and the chestplate, the End for the rest
  {
    id: "diamond_sword",
    title: "a diamond sword",
    tier: 3,
    requires: ["diamond_pickaxe"],
    done: () => toolTier("sword") >= TIER.diamond,
    achieve: () => makeDiamondGear("diamond_sword"),
  },
  {
    id: "diamond_chestplate",
    title: "a diamond chestplate",
    tier: 3,
    requires: ["diamond_sword"],
    done: () => owns("diamond_chestplate"),
    achieve: () => makeDiamondGear("diamond_chestplate"),
  },
  {
    id: "diamond_armor",
    title: "diamond armour",
    tier: 3,
    requires: ["diamond_chestplate"],
    done: () => DIAMOND_GEAR.every(([piece]) => owns(piece)),
    achieve: async () => {
      for (const [piece] of DIAMOND_GEAR) {
        if (owns(piece)) continue;
        const made = await makeDiamondGear(piece);
        if (!made.ok) return made;
      }
      return ok();
    },
  },
  // Phase 9: the Nether and the End (skills/endgame)
  ...ENDGAME_MILESTONES,
];

const DIAMONDS = 3;

/**
 * Its diamond gear in the order it's made, with what each takes: the pickaxe
 * (obsidian for the Nether portal), the sword, then the armour, the
 * chestplate first. 29 diamonds in all.
 */
export const DIAMOND_GEAR: Array<[string, number]> = [
  ["diamond_pickaxe", 3],
  ["diamond_sword", 2],
  ["diamond_chestplate", 8],
  ["diamond_leggings", 7],
  ["diamond_helmet", 5],
  ["diamond_boots", 4],
];
const DIAMOND_SLOTS: Record<string, "head" | "torso" | "legs" | "feet"> = {
  diamond_chestplate: "torso",
  diamond_leggings: "legs",
  diamond_helmet: "head",
  diamond_boots: "feet",
};

/** The next diamond piece it doesn't have, with its cost, or null when it has them all. Pure. */
export function nextDiamondPiece(has: (item: string) => boolean): [string, number] | null {
  return DIAMOND_GEAR.find(([piece]) => !has(piece)) ?? null;
}

/** The diamonds the pieces it hasn't made yet still take. Pure. */
export function diamondsStillWanted(has: (item: string) => boolean): number {
  return DIAMOND_GEAR.filter(([piece]) => !has(piece)).reduce((n, [, cost]) => n + cost, 0);
}

/** True when it carries the wood for a tool's 2 sticks (sticks, planks or a log). Pure. */
export function sticksCarried(items: Array<{ name: string; count: number }>): boolean {
  const n = (re: RegExp): number => items.filter((i) => re.test(i.name)).reduce((c, i) => c + i.count, 0);
  return n(/^stick$/) >= 2 || n(/_planks$/) >= 2 || n(/(_log|_stem|_wood|_hyphae)$/) >= 1;
}

/** True when it carries everything for this diamond piece (the diamonds, and the wood for a tool's sticks). Pure. */
export function diamondPieceCarried(piece: string, cost: number, items: Array<{ name: string; count: number }>): boolean {
  const diamonds = items.filter((i) => i.name === "diamond").reduce((n, i) => n + i.count, 0);
  return diamonds >= cost && (piece in DIAMOND_SLOTS || sticksCarried(items));
}

/** The diamond piece it can make now with the diamonds it owns (bag and chests), or null. */
export function diamondPieceDue(): [string, number] | null {
  const next = nextDiamondPiece(owns);
  return next && owned(["diamond"]) >= next[1] ? next : null;
}

/**
 * Mines diamonds until it owns `total` (bag and chests): a mining trip for
 * the ones its chests don't hold.
 */
async function mineDiamonds(total: number): Promise<ActionResult> {
  const inChests = owned(["diamond"]) - carriedOf(["diamond"]);
  return branchMine([{ item: "diamond", enough: Math.max(1, total - inChests), counts: ["diamond"] }], 20);
}

/**
 * A diamond piece: the diamonds mined first if it owns too few (bag and
 * chests); made at the nearest crafting table when it carries everything
 * for it (a floor of its mine has one), else at home, where its chests have
 * the diamonds and the wood; armour is put on at once.
 */
export async function makeDiamondGear(piece: string): Promise<ActionResult> {
  const cost = DIAMOND_GEAR.find(([p]) => p === piece)?.[1];
  if (cost === undefined) return fail("not_found", `no diamond piece called ${piece}`);
  if (owns(piece)) return ok();
  if (owned(["diamond"]) < cost) {
    const mined = await mineDiamonds(cost);
    if (!mined.ok && owned(["diamond"]) < cost) return mined;
  }
  const what = piece.replace(/_/g, " ");
  if (diamondPieceCarried(piece, cost, bot.inventory.items())) {
    console.log(`Diamond gear: everything for a ${what} is in my bag; at the nearest crafting table.`);
  } else {
    await enterShelter(); // its table, and its chests with the diamonds and wood
    const short = cost - carriedOf(["diamond"]);
    if (short > 0) {
      const { takeItems } = await import("../actions/storage");
      await takeItems([{ name: "diamond", count: short }], true);
    }
  }
  const made = await acquire(piece, 1, liveWorld);
  if (!made.ok) return made;
  const slot = DIAMOND_SLOTS[piece];
  if (slot) {
    const { equipItem } = await import("../core/primitives");
    await equipItem(piece, slot);
  }
  report(`Made a ${what}!`);
  return ok();
}
const TORCHES = 16;
const TORCHES_LOW = 8;
const PAVE_AFTER = 200;

/** Cobblestone it carries and has in its chests (as last seen). */
/** How many of these items it has, carried and in its chests (as last seen). */
export function owned(names: string[]): number {
  const stored = (getMemory().chests ?? []).reduce((n, c) => n + names.reduce((m, name) => m + ((c.contents as Record<string, number> | null)?.[name] ?? 0), 0), 0);
  return carriedOf(names) + stored;
}
function cobblestoneOwned(): number {
  return owned(["cobblestone"]);
}
// Owner: the shelter gets smooth stone only, and only once there are two
// stacks of coal for the furnace (smooth stone is cobblestone smelted twice)
export const REINFORCE_COAL = 128;
// Logs it keeps on hand after its stone tools (owner)
export const WOOD_STOCK = 20;
const LOG_NAMES = (): string[] => Object.keys(bot.registry.itemsByName).filter((n) => catalog().isLog(n));
/** Ready to reinforce: coal enough, and smooth stone made (by the workshop, in the background). */
const readyToReinforce = (): boolean => owned(["coal"]) >= REINFORCE_COAL && owned(["smooth_stone"]) > 0;
// Each piece, the ingots it takes, and where it's worn
const IRON_ARMOR: Array<[string, number, "head" | "torso" | "legs" | "feet"]> = [
  ["iron_helmet", 5, "head"],
  ["iron_chestplate", 8, "torso"],
  ["iron_leggings", 7, "legs"],
  ["iron_boots", 4, "feet"],
];

// Armour by what it protects for the iron: chestplate, leggings, helmet, boots
const ARMOR_BEST_FIRST = ["iron_chestplate", "iron_leggings", "iron_helmet", "iron_boots"];

/**
 * The iron pieces it can make now with `iron` ingots (raw counts: it's
 * smelted), best first, each one paid for before the next; pieces it owns
 * are left out. Pure over `owns`.
 */
export function armorPiecesNow(iron: number, owned: (item: string) => boolean): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  let left = iron;
  for (const name of ARMOR_BEST_FIRST) {
    const cost = IRON_ARMOR.find(([p]) => p === name)![1];
    if (owned(name) || cost > left) continue;
    out.push([name, cost]);
    left -= cost;
  }
  return out;
}

/** Carried, worn or in the off-hand. */
function owns(item: string): boolean {
  return bot.inventory.slots.some((i) => i?.name === item);
}

/**
 * Makes these iron things (each with the ingots it takes) it doesn't have
 * yet: mines the raw iron missing (its mine), smelts it at home and crafts
 * them at the shelter's table.
 */
async function makeFromIron(things: Array<[string, number]>): Promise<ActionResult> {
  const missing = things.filter(([item]) => !owns(item));
  const ingots = missing.reduce((n, [, cost]) => n + cost, 0);
  if (ingots === 0) return ok();
  const have = (): number => carriedOf(["iron_ingot"]) + carriedOf(["raw_iron"]);
  // Iron in its own chests first (put away at home), then the mine (review)
  if (have() < ingots) {
    const { storedNear, takeItems } = await import("../actions/storage");
    for (const name of ["iron_ingot", "raw_iron"]) {
      const short = ingots - have();
      if (short > 0 && storedNear(name, 32) > 0) await takeItems([{ name, count: short }], true);
    }
  }
  // ... and in its home furnace (the workshop may be smelting it, review)
  if (have() < ingots) {
    const { takeFromHomeFurnace } = await import("./workshop");
    await takeFromHomeFurnace(["iron_ingot", "raw_iron"]);
  }
  if (have() < ingots) {
    const mined = await branchMine([{ item: "raw_iron", enough: ingots - carriedOf(["iron_ingot"]), counts: ["raw_iron"] }], 20);
    if (!mined.ok && have() < ingots) return mined;
  }
  return smeltAndCraft(missing, "raw_iron", () => getAll(missing.map(([item]) => item)));
}

/**
 * Smelts its raw iron and makes the things. Everything carried (iron,
 * fuel, wood for sticks and planks): at the nearest furnace and table, down
 * in its mine its floor's; something short: home, where its chests are
 * (owner, 2026-11-28: "use the nearest first if the bot has everything for
 * that in its inventory; in case it needs something from the chest, go to
 * the shelter"; it had climbed 44 steps home for every armor piece).
 */
async function smeltAndCraft(things: Array<[string, number]>, raw: string, make: () => Promise<ActionResult>): Promise<ActionResult> {
  const carried = (): boolean => ironJobCarried(things, bot.inventory.items());
  let home = false;
  const goHome = async (): Promise<void> => {
    home = true;
    const there = await enterShelter(); // the furnace, the table and the chests are there
    if (!there.ok) console.log(`Couldn't get home to smelt (${describeFailure(there)}); smelting where I am.`);
    if (!carried()) await takeForIronJob(things);
  };
  if (!carried() || !(await toNearestFurnace())) await goHome();
  else console.log(`Everything for ${things.map(([t]) => t).join(", ")} is in my bag: smelting and crafting at the nearest furnace and table.`);
  if (carriedOf([raw]) > 0) {
    const { smelt } = await import("../actions/cooking");
    let made = await smelt(raw, carriedOf([raw]));
    if (made === null && !home) {
      await goHome();
      made = await smelt(raw, carriedOf([raw]));
    }
    if (made === null) console.log("No furnace or fuel to smelt my iron.");
    else if (made > 0) report(`Smelted ${made} iron ingots.`);
  }
  return make();
}

// Sticks and planks each iron thing takes (the rest is iron)
const IRON_JOB_STICKS: Record<string, number> = { iron_sword: 1, iron_pickaxe: 2, iron_axe: 2, iron_shovel: 1, iron_hoe: 2 };
const IRON_JOB_PLANKS: Record<string, number> = { shield: 6 };

/**
 * True when it carries all an iron job needs: the iron (ingots and raw),
 * fuel for the raw (coal or charcoal 8 each, planks and logs 1.5), and wood
 * for the sticks and planks (a log is 4 planks, 2 planks 4 sticks). Pure.
 */
export function ironJobCarried(things: Array<[string, number]>, items: Array<{ name: string; count: number }>): boolean {
  const count = (re: RegExp): number => items.filter((i) => re.test(i.name)).reduce((n, i) => n + i.count, 0);
  const iron = things.reduce((n, [, cost]) => n + cost, 0);
  const ingots = count(/^iron_ingot$/);
  if (ingots + count(/^raw_iron$/) < iron) return false;
  const sticksShort = Math.max(0, things.reduce((n, [t]) => n + (IRON_JOB_STICKS[t] ?? 0), 0) - count(/^stick$/));
  const planksNeeded = Math.ceil(sticksShort / 4) * 2 + things.reduce((n, [t]) => n + (IRON_JOB_PLANKS[t] ?? 0), 0);
  let planks = count(/_planks$/);
  let logs = count(/(_log|_stem|_wood|_hyphae)$/);
  const fromPlanks = Math.min(planks, planksNeeded);
  planks -= fromPlanks;
  const logsCut = Math.ceil((planksNeeded - fromPlanks) / 4);
  if (logsCut > logs) return false;
  logs -= logsCut;
  const fuel = 8 * count(/^(coal|charcoal)$/) + 80 * count(/^coal_block$/) + 1.5 * (planks + logs);
  return fuel >= Math.max(0, iron - ingots);
}

/** At home: coal and wood from its chests for an iron job it's short for (best effort). */
async function takeForIronJob(things: Array<[string, number]>): Promise<void> {
  const { storedNear, takeItems } = await import("../actions/storage");
  for (const [name, n] of [["coal", 8], ["charcoal", 8], ["logs", 4]] as const) {
    if (ironJobCarried(things, bot.inventory.items())) return;
    if (storedNear(name, 32) > 0) await takeItems([{ name, count: n }], true);
  }
}

/**
 * Near the nearest furnace on its own level (its floor's, down in its mine;
 * never the home one through the rock). False when there's none.
 */
async function toNearestFurnace(): Promise<boolean> {
  const id = bot.registry.blocksByName["furnace"]?.id;
  if (id === undefined || !bot.entity) return false;
  const me = bot.entity.position;
  const near = bot
    .findBlocks({ matching: [id], maxDistance: 64, count: 16 })
    // On its own level, or (down in its mine) a floor up or down: never the home one through the rock
    .filter((p) => Math.abs(p.y - me.y) <= (shelter() && me.y < shelter()!.y - 12 ? 12 : 3))
    .sort((a, b) => a.distanceTo(me) - b.distanceTo(me))[0];
  if (!near) return false;
  if (near.distanceTo(me) <= 16) return true;
  return (await goTo(new pf.goals.GoalNear(near.x, near.y, near.z, 2))).ok;
}

/**
 * With its raw iron it smelts it and makes an iron pickaxe: at the nearest
 * furnace and table when it carries everything, else at home (owner).
 */
export async function smeltIronAndMakePickaxe(): Promise<ActionResult> {
  return smeltAndCraft([["iron_pickaxe", 3]], "raw_iron", () => acquire("iron_pickaxe", 1, liveWorld));
}

const carriedOf = (names: string[]): number => bot.inventory.items().filter((i) => names.includes(i.name)).reduce((n, i) => n + i.count, 0);

/** The next milestone not done (and not blocked), lowest tier first; null when all are reached. */
export function nextMilestone(list: Milestone[], blocked: (id: string) => boolean = () => false, here: (m: Milestone) => boolean = milestoneHere): Milestone | null {
  // Its prerequisites done (a set-aside shelter must not let stone tools or the mine jump ahead)
  const ready = (m: Milestone): boolean => (m.requires ?? []).every((id) => list.find((x) => x.id === id)?.done() ?? true);
  const tiers = [...new Set(list.map((m) => m.tier))].sort((a, b) => a - b);
  const main = ((): Milestone | null => {
    for (const tier of tiers) {
      // Only what can be worked on in this dimension (in the Nether its first
      // day's milestones wait: their shelter and food checks would mislead);
      // low-priority (idle) ones wait for the end
      const open = list.filter((m) => m.tier === tier && !m.idle && here(m) && !m.done());
      if (open.length === 0) continue;
      const now = open.find((m) => !blocked(m.id) && ready(m));
      if (now) return now;
      // A tier isn't skipped while any of it is left (a blocked one waits its
      // turn), unless all that's left of it is optional: lighting further out
      // or the farm, when they can't be done right now, never hold the day up
      // ... nor a supply it has had before that's running low again
      if (open.every((m) => m.optional || (m.supply && reachedAt()[m.id]))) continue;
      return null;
    }
    return null;
  })();
  if (main) return main;
  // Nothing else on its list can be done now (iron set aside after a failed
  // trip, say): a low-priority job, the earliest one whose earlier tiers are clear
  const earlierClear = (m: Milestone): boolean =>
    !list.some((x) => x.tier < m.tier && !x.idle && here(x) && !x.done() && !x.optional && !(x.supply && reachedAt()[x.id]));
  return list.find((m) => m.idle && here(m) && !m.done() && !blocked(m.id) && ready(m) && earlierClear(m)) ?? null;
}

/**
 * What holds `m` back in the safety order: what it requires that isn't done,
 * and the milestones of an earlier tier still to do here (not optional, not
 * a supply it has had before), like the tier gate in `nextMilestone`. Empty when its tier is open. The day plan
 * goes by it too (review: a plan step could send it after diamonds or to the
 * Nether before its shield, bucket and armour).
 */
export function heldBy(m: Milestone, list: Milestone[] = MILESTONES, here: (m: Milestone) => boolean = milestoneHere): string[] {
  const needs = (m.requires ?? []).filter((id) => list.find((x) => x.id === id)?.done() === false);
  // (a low-priority job also waits for the rest of its own tier: the day
  // plan put the smooth stone shelter ahead of iron)
  const earlier = list
    .filter((x) => (x.tier < m.tier || (m.idle && x.tier === m.tier && !x.idle)) && here(x) && !x.done() && !x.optional && !(x.supply && reachedAt()[x.id]))
    .map((x) => x.id);
  return [...new Set([...needs, ...earlier])];
}

/**
 * True when its first day is done: every Tier 1 milestone done now, a
 * supply it has had before counting as done (food or tools running low
 * don't count: review, the day planner went off whenever food dropped).
 */
export function tier1Reached(list: Milestone[] = MILESTONES): boolean {
  // A supply it has had counts; a broken shelter, a lost bed or chests don't
  // (review: once reached, the day plan ran on with its home in pieces)
  return list.filter((m) => m.tier === 1).every((m) => m.done() || (m.supply && reachedAt()[m.id]));
}

// --- First reached (for the announcement, and the diary later) -------------------

/** When each milestone was first reached. */
export function reachedAt(): Record<string, number> {
  return getMemory().milestones ?? {};
}

/** Notes milestones done for the first time; returns them (to announce). */
export async function noteReached(list: Milestone[] = MILESTONES): Promise<Milestone[]> {
  const known = reachedAt();
  // Only what can be checked here, only what's really achieved, and only
  // once what it requires is done (game test: in a new world with no
  // shelter, "a lit home" and both wider grades were announced at once)
  const needsDone = (m: Milestone): boolean => (m.requires ?? []).every((id) => list.find((x) => x.id === id)?.done() ?? true);
  const fresh = list.filter((m) => !known[m.id] && milestoneHere(m) && needsDone(m) && (m.reached ?? m.done)());
  if (fresh.length === 0) return [];
  const next = { ...known };
  for (const m of fresh) next[m.id] = Date.now();
  await updateMemory({ milestones: next });
  return fresh;
}
