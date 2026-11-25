// Path: src/skills/milestones.ts
// The milestone list (Phase 6), replacing the two unused progression lists.
// Each milestone has a done-check computed from what the bot has right now
// (skills/capabilities: a lost pickaxe or a broken bed undoes it) and the
// steps that get it there. Tier 1 is a player's first day: wooden tools, a
// shelter, stone tools, food, a bed (spawn point set) and the shelter set up with its
// stuff put away. Later tiers are listed for Phase 7 to plan toward.

import { bot } from "../core/body";
import { describeFailure, fail, ok, type ActionResult } from "../core/result";
import { getMemory, updateMemory } from "../managers/persistenceManager";
import { acquire } from "./acquire";
import { liveWorld } from "./world";
import { animalsInSight, exploreFor } from "./explore";
import { isCommandCancelled } from "../core/commandContext";
import { bestWool, foodPoints, hasBed, shelter, TIER, toolTier } from "./capabilities";
import { buildShelter, enterShelter, rightChest, setupTheShelter, shelterSlots, tableWithin } from "../actions/building";
import { TABLE_RANGE } from "../actions/crafting";
import { branchMine, COAL, digMine, IRON, myMine } from "./mine";
import { goTo, knownBlock } from "../core/primitives";
import pf from "mineflayer-pathfinder";
import { catalog } from "../core/catalog";
import { breakBlockAtResult, pickupNearbyItems, placeBlockResult } from "../actions/worldInteraction";

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
};

const FOOD_STOCK = 20; // food points carried: a couple of days' eating
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
  if (foodPoints() < FOOD_STOCK) await pickBerries();
  if (foodPoints() < FOOD_STOCK) await hunt({ maxDistance: 60, mobType: null, count: 4 });
  // Hunted out around here: go farther and hunt there (a player doesn't wait hungry)
  for (let trip = 0; trip < 2 && foodPoints() < FOOD_STOCK && !isCommandCancelled(); trip++) {
    if (!(await exploreFor("animals", animalsInSight))) break;
    await hunt({ maxDistance: 40, mobType: null, count: 4 });
  }
  // Raw meat is worth more cooked: a furnace from the cobblestone it has
  const hasRaw = bot.inventory.items().some((i) => /^(beef|porkchop|mutton|chicken|rabbit|cod|salmon)$/.test(i.name));
  if (hasRaw) {
    if (!(await cookFood()) && (await acquire("furnace", 1, liveWorld)).ok) await cookFood();
  }
  return foodPoints() >= foodTarget() ? ok() : fail("missing_items", `only ${foodPoints()} food points; no more animals or berries around`);
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
  // The table: its spot, or any table within 50 blocks (it never places a second one close by)
  const table = has(slots.table, "crafting_table") || tableWithin(TABLE_RANGE);
  // Chests facing the middle (a wrong-facing pair never joins into a double chest)
  const chests = slots.chests.every((c) => !knownBlock(c) || (slots.direction ? rightChest(c, slots.stand, slots.direction) : has(c, "chest")));
  return chests && has(slots.furnace, "furnace") && table;
}

/** Every milestone, in the order the bot goes for them. */
export const MILESTONES: Milestone[] = [
  {
    id: "wooden_tools",
    title: "wooden tools",
    tier: 1,
    // A player's first set: dirt everywhere wants a shovel, trees an axe
    done: () => (["pickaxe", "axe", "shovel", "sword"] as const).every((k) => toolTier(k) >= TIER.wooden),
    achieve: () => getAll(["wooden_pickaxe", "wooden_axe", "wooden_shovel", "wooden_sword"]),
  },
  {
    id: "shelter",
    title: "a shelter",
    tier: 1,
    done: () => shelter() !== null,
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
    id: "iron",
    title: "iron",
    tier: 2,
    requires: ["mine"],
    // Made into tools later: found once is reached
    done: () => Boolean(reachedAt()["iron"]) || carriedOf(IRON.counts) >= IRON.enough,
    achieve: () => branchMine([IRON, COAL]),
  },
];

const carriedOf = (names: string[]): number => bot.inventory.items().filter((i) => names.includes(i.name)).reduce((n, i) => n + i.count, 0);

/** The next milestone not done (and not blocked), lowest tier first; null when all are reached. */
export function nextMilestone(list: Milestone[], blocked: (id: string) => boolean = () => false): Milestone | null {
  // Its prerequisites done (a set-aside shelter must not let stone tools or the mine jump ahead)
  const ready = (m: Milestone): boolean => (m.requires ?? []).every((id) => list.find((x) => x.id === id)?.done() ?? true);
  const tiers = [...new Set(list.map((m) => m.tier))].sort((a, b) => a - b);
  for (const tier of tiers) {
    const open = list.filter((m) => m.tier === tier && !m.done());
    if (open.length === 0) continue;
    // A tier isn't skipped while any of it is left (a blocked one waits its turn)
    return open.find((m) => !blocked(m.id) && ready(m)) ?? null;
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
  const fresh = list.filter((m) => !known[m.id] && m.done());
  if (fresh.length === 0) return [];
  const next = { ...known };
  for (const m of fresh) next[m.id] = Date.now();
  await updateMemory({ milestones: next });
  return fresh;
}
