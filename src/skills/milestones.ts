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
import { animalsInSight, exploreFor } from "./explore";
import { isCommandCancelled } from "../core/commandContext";
import { bestWool, foodPoints, hasBed, shelter, TIER, toolTier } from "./capabilities";
import { buildShelter, chestInPlace, enterShelter, setupTheShelter, shelterIntact, shelterSlots } from "../actions/building";
import { branchMine, COAL, digMine, IRON, myMine, paveMineStairs, stairsPaved, unpavedSteps } from "./mine";
import { ENDGAME_MILESTONES } from "./endgame/milestones";
import { homeLit, homeLitSeen, lightUpHome } from "./lighting";
import { makeFarm, myFarm, tendFarm } from "./farm";
import { dimensionNow } from "./endgame/state";
import { goTo, knownBlock } from "../core/primitives";
import pf from "mineflayer-pathfinder";
import { catalog } from "../core/catalog";
import { breakBlockAtResult } from "../actions/blockBreaking";
import { placeBlockResult } from "../actions/blockPlacing";
import { pickupNearbyItems } from "../actions/pickup";

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
};

/** True when a milestone can be checked and worked on in the dimension it's in now. */
export function milestoneHere(m: Milestone): boolean {
  return m.dimension === "any" || dimensionNow() === "overworld";
}

const FOOD_STOCK = 20; // food points carried: a couple of days' eating
// Carrying less than this: starving (apples from leaves are worth the trouble)
const STARVING_FOOD = 6;
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

/** Food: berries, then hunting, then cooking what it caught. */
async function stockFood(): Promise<ActionResult> {
  const { pickBerries } = await import("../commands/StarterKit");
  const { execute: hunt } = await import("../commands/Hunting");
  const { cookFood } = await import("../actions/cooking");
  // Its farm first (owner: hunting isn't sustainable), then berries, then hunting
  if (foodPoints() < FOOD_STOCK && myFarm()) await tendFarm();
  if (foodPoints() < FOOD_STOCK) await pickBerries();
  if (foodPoints() < FOOD_STOCK) await hunt({ maxDistance: 60, mobType: null, count: 4 });
  // Hunted out around here: go farther and hunt there (a player doesn't wait hungry)
  for (let trip = 0; trip < 2 && foodPoints() < FOOD_STOCK && !isCommandCancelled(); trip++) {
    if (!(await exploreFor("animals", animalsInSight))) break;
    await hunt({ maxDistance: 40, mobType: null, count: 4 });
  }
  // Starving and nothing else found: apples from oak leaves round about
  // (owner: if it's starving and there are oak trees near, their leaves give
  // apples; one leaf in 200 does, so it's a last resort, by day)
  if (foodPoints() < STARVING_FOOD && bot.time?.isDay !== false && !isCommandCancelled()) {
    const { applesFromLeaves } = await import("./apples");
    await applesFromLeaves();
  }
  // Still short, no farm yet, its bucket at hand, by day: the farm now. Food
  // is a first-day milestone and the farm a later one, so while food kept
  // failing the farm never came up (game test: 0 food points, no animals
  // in the open, the same loop every two minutes)
  const hasBucket = bot.inventory.items().some((i) => /^(water_)?bucket$/.test(i.name));
  if (foodPoints() < FOOD_STOCK && !myFarm() && hasBucket && bot.time?.isDay !== false && !isCommandCancelled()) {
    const made = await makeFarm();
    if (!made.ok) console.log(`Food: no farm yet (${describeFailure(made)}).`);
  }
  // Raw meat is worth more cooked: a furnace from the cobblestone it has
  const hasRaw = bot.inventory.items().some((i) => /^(beef|porkchop|mutton|chicken|rabbit|cod|salmon)$/.test(i.name));
  if (hasRaw) await cookTheMeat(cookFood);
  return foodPoints() >= foodTarget() ? ok() : fail("missing_items", `only ${foodPoints()} food points; no more animals or berries around`);
}

/**
 * Raw meat cooked like a player: in its shelter's furnace (walking home from
 * the hunt), with coal or wood from its chests when it carries no fuel. A
 * furnace of its own only without one at home, and never without fuel (80
 * blocks out it made a table and a furnace, then had nothing to burn).
 */
async function cookTheMeat(cookFood: () => Promise<number | null>): Promise<void> {
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

/** A bed: 3 wool of one colour (from sheep), crafted, put in its slot in the shelter, used (spawn point). */
async function getBed(): Promise<ActionResult> {
  if (!bot.inventory.items().some((i) => i.name.endsWith("_bed"))) {
    let wool = bestWool();
    if (!wool || wool[1] < 3) {
      // More of the colour it already has (most sheep are white)
      const colour = wool?.[0] ?? "white";
      const got = await acquire(`${colour}_wool`, 3, liveWorld);
      wool = bestWool();
      if (!got.ok && (!wool || wool[1] < 3)) {
        console.log(`Bed: no 3 ${colour} wool (${describeFailure(got)}); best is ${wool ? `${wool[1]} ${wool[0]}` : "none"}.`);
        return fail("missing_items", `I need 3 wool of one colour for a bed (${describeFailure(got)})`);
      }
    }
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
    // head goes along the wall; a table already there is moved for a moment
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
      // Back in its spot (stepping out of it first)
      await goTo(new pf.goals.GoalBlock(slots.stand.x, slots.stand.y, slots.stand.z));
      await placeBlockResult("crafting_table", slots.bedStand.x, slots.bedStand.y, slots.bedStand.z);
    }
    if (!placed.ok) return placed;
  }
  const { execute: sleep } = await import("../commands/Sleep");
  await sleep({ newBed: false }); // its new bed is the nearest: uses it (by day too), so the spawn point is set
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
  await storeItems("lowValue");
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
    requires: ["shelter"],
    // Two pickaxes: mining wears one out
    done: () => (["axe", "shovel", "sword"] as const).every((k) => toolTier(k) >= TIER.stone) && pickaxesOfTier(TIER.stone) >= 2,
    achieve: () => getAll(["2 stone_pickaxe", "stone_axe", "stone_shovel", "stone_sword"]),
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
    id: "food",
    title: "a food stock",
    tier: 1,
    requires: ["chests"],
    done: () => foodPoints() >= foodTarget(),
    achieve: stockFood,
  },
  {
    id: "bed",
    title: "a bed",
    tier: 1,
    requires: ["chests"],
    done: hasBed,
    achieve: getBed,
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
  {
    id: "coal",
    title: "coal",
    tier: 2,
    requires: ["mine"],
    // Torches and smelting use it up: once found, only below 4 does it go back for more
    done: () => carriedOf(COAL.counts) >= (reachedAt()["coal"] ? 4 : COAL.enough),
    achieve: () => branchMine([COAL, IRON]),
  },
  {
    id: "torches",
    title: "torches",
    tier: 2,
    requires: ["coal"],
    // A player lights the way down before going deep (a skeleton in its dark
    // stairs, mobs spawning in its tunnels): 16 made, and topped up below 8
    done: () => carriedOf(["torch"]) >= (reachedAt()["torches"] ? TORCHES_LOW : TORCHES),
    achieve: () => getAll([`${TORCHES} torch`]),
  },
  {
    id: "lit_home",
    title: "a lit home",
    tier: 2,
    optional: true,
    requires: ["torches"],
    // Owner: mobs kept coming at the shelter because nothing round it was
    // lit. Torches on the room's walls and in a grid on the ground round it
    // (by day); put back when a creeper knocks them out
    done: () => shelter() === null || homeLit(),
    achieve: () => lightUpHome(bot.time?.isDay !== false),
    reached: () => homeLitSeen(0),
  },
  {
    id: "paved_stairs",
    title: "paved mine stairs",
    tier: 2,
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
    dimension: "any",
    requires: ["iron_pickaxe"],
    // Any bucket counts (it pours the water out for obsidian and takes it back)
    done: () => owns("bucket") || owns("water_bucket") || owns("lava_bucket"),
    achieve: async () => {
      const made = await makeFromIron([["bucket", 3]]);
      if (!made.ok) return made;
      // Filled where there's water in sight (by day: at night that may be
      // out in the open); an empty one is filled later
      if (bot.time?.isDay === false) return ok();
      const { fillWater } = await import("./endgame/portal");
      const filled = await fillWater();
      if (!filled.ok) console.log(`Bucket: not filled yet (${describeFailure(filled)}).`);
      return ok();
    },
  },
  {
    id: "farm",
    title: "a farm",
    tier: 3,
    optional: true,
    requires: ["bucket"],
    // Owner: hunting isn't a sustainable way to get food; a plot by the
    // shelter with water in it (so the water bucket comes first). By day
    done: () => myFarm() !== null,
    achieve: makeFarm,
  },
  {
    id: "iron_armor",
    title: "iron armor",
    tier: 3,
    requires: ["iron_pickaxe"],
    done: () => IRON_ARMOR.every(([piece]) => owns(piece)),
    achieve: async () => {
      const made = await makeFromIron(IRON_ARMOR.map(([piece, n]) => [piece, n]));
      if (!made.ok) return made;
      // Put it on
      const { equipItem } = await import("../core/primitives");
      for (const [piece, , slot] of IRON_ARMOR) if (carriedOf([piece]) > 0) await equipItem(piece, slot);
      return ok();
    },
  },
  // The lit ground round its home, further out (owner: in grades, each once
  // the one before is done; by day)
  {
    id: "lit_home_2",
    title: "my home lit twice as far",
    tier: 3,
    optional: true,
    requires: ["lit_home"],
    done: () => shelter() === null || homeLit(1),
    achieve: () => lightUpHome(bot.time?.isDay !== false, 1),
    reached: () => homeLitSeen(1),
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
    requires: ["lit_home_2"],
    done: () => shelter() === null || homeLit(2),
    achieve: () => lightUpHome(bot.time?.isDay !== false, 2),
    reached: () => homeLitSeen(2),
  },
  {
    id: "diamonds",
    title: "diamonds",
    tier: 3,
    requires: ["iron_pickaxe"],
    // Deep in the mine: its hubs go 20 steps deeper each time all three tunnels are done
    done: () => carriedOf(["diamond"]) >= DIAMONDS || toolTier("pickaxe") >= TIER.diamond,
    achieve: () => branchMine([{ item: "diamond", enough: DIAMONDS, counts: ["diamond"] }], 20),
  },
  {
    id: "diamond_pickaxe",
    title: "a diamond pickaxe",
    tier: 3,
    requires: ["diamonds"],
    done: () => toolTier("pickaxe") >= TIER.diamond,
    achieve: async () => {
      await enterShelter(); // its table
      return acquire("diamond_pickaxe", 1, liveWorld);
    },
  },
  // Phase 9: the Nether and the End (skills/endgame)
  ...ENDGAME_MILESTONES,
];

const DIAMONDS = 3;
const TORCHES = 16;
const TORCHES_LOW = 8;
const PAVE_AFTER = 200;

/** Cobblestone it carries and has in its chests (as last seen). */
function cobblestoneOwned(): number {
  const stored = (getMemory().chests ?? []).reduce((n, c) => n + ((c.contents as Record<string, number> | null)?.["cobblestone"] ?? 0), 0);
  return carriedOf(["cobblestone"]) + stored;
}
// Each piece, the ingots it takes, and where it's worn
const IRON_ARMOR: Array<[string, number, "head" | "torso" | "legs" | "feet"]> = [
  ["iron_helmet", 5, "head"],
  ["iron_chestplate", 8, "torso"],
  ["iron_leggings", 7, "legs"],
  ["iron_boots", 4, "feet"],
];

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
  if (have() < ingots) {
    const mined = await branchMine([{ item: "raw_iron", enough: ingots - carriedOf(["iron_ingot"]), counts: ["raw_iron"] }], 20);
    if (!mined.ok && have() < ingots) return mined;
  }
  // Home: the furnace for the raw iron, the table for the crafting
  const home = await enterShelter();
  if (!home.ok) console.log(`Couldn't get home to smelt (${describeFailure(home)}); smelting where I am.`);
  const raw = carriedOf(["raw_iron"]);
  if (raw > 0) {
    const { smelt } = await import("../actions/cooking");
    const made = await smelt("raw_iron", raw);
    if (made !== null && made > 0) report(`Smelted ${made} iron ingots.`);
  }
  return getAll(missing.map(([item]) => item));
}

/**
 * Owner: with its raw iron it goes home, smelts it in the shelter's furnace
 * and makes an iron pickaxe at the shelter's table.
 */
export async function smeltIronAndMakePickaxe(): Promise<ActionResult> {
  const home = await enterShelter(); // the furnace and the table are there
  if (!home.ok) console.log(`Couldn't get home to smelt (${describeFailure(home)}); smelting where I am.`);
  const raw = carriedOf(["raw_iron"]);
  if (raw > 0) {
    const { smelt } = await import("../actions/cooking");
    const made = await smelt("raw_iron", raw);
    if (made === null) console.log("No furnace or fuel to smelt my iron.");
    else if (made > 0) report(`Smelted ${made} iron ingots.`);
  }
  return acquire("iron_pickaxe", 1, liveWorld);
}

const carriedOf = (names: string[]): number => bot.inventory.items().filter((i) => names.includes(i.name)).reduce((n, i) => n + i.count, 0);

/** The next milestone not done (and not blocked), lowest tier first; null when all are reached. */
export function nextMilestone(list: Milestone[], blocked: (id: string) => boolean = () => false, here: (m: Milestone) => boolean = milestoneHere): Milestone | null {
  // Its prerequisites done (a set-aside shelter must not let stone tools or the mine jump ahead)
  const ready = (m: Milestone): boolean => (m.requires ?? []).every((id) => list.find((x) => x.id === id)?.done() ?? true);
  const tiers = [...new Set(list.map((m) => m.tier))].sort((a, b) => a - b);
  for (const tier of tiers) {
    // Only what can be worked on in this dimension (in the Nether its first
    // day's milestones wait: their shelter and food checks would mislead)
    const open = list.filter((m) => m.tier === tier && here(m) && !m.done());
    if (open.length === 0) continue;
    const now = open.find((m) => !blocked(m.id) && ready(m));
    if (now) return now;
    // A tier isn't skipped while any of it is left (a blocked one waits its
    // turn), unless all that's left of it is optional: lighting further out
    // or the farm, when they can't be done right now, never hold the day up
    if (open.every((m) => m.optional)) continue;
    return null;
  }
  return null;
}

/** True when every Tier 1 milestone is done. */
export function tier1Reached(list: Milestone[] = MILESTONES): boolean {
  return list.filter((m) => m.tier === 1).every((m) => m.done());
}

// --- First reached (for the announcement, and the diary later) -------------------

/** When each milestone was first reached. */
export function reachedAt(): Record<string, number> {
  return getMemory().milestones ?? {};
}

/** Notes milestones done for the first time; returns them (to announce). */
export async function noteReached(list: Milestone[] = MILESTONES): Promise<Milestone[]> {
  const known = reachedAt();
  // Only what can be checked here, and only what's really achieved
  const fresh = list.filter((m) => !known[m.id] && milestoneHere(m) && (m.reached ?? m.done)());
  if (fresh.length === 0) return [];
  const next = { ...known };
  for (const m of fresh) next[m.id] = Date.now();
  await updateMemory({ milestones: next });
  return fresh;
}
