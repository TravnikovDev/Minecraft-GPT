// Path: src/skills/milestones.ts
// The milestone list (Phase 6), replacing the two unused progression lists.
// Each milestone has a done-check computed from what the bot has right now
// (skills/capabilities: a lost pickaxe or a broken bed undoes it) and the
// steps that get it there. Tier 1 is a player's first day: wooden tools, a
// shelter, stone tools, food, a bed (spawn point set) and two chests with its
// stuff put away. Later tiers are listed for Phase 7 to plan toward.

import { bot } from "../core/body";
import { fail, ok, type ActionResult } from "../core/result";
import { getMemory, updateMemory } from "../managers/persistenceManager";
import { acquire } from "./acquire";
import { liveWorld } from "./world";
import { animalsInSight, exploreFor } from "./explore";
import { isCommandCancelled } from "../core/commandContext";
import { bestWool, chestsNear, foodPoints, hasBed, shelter, TIER, toolTier } from "./capabilities";
import { buildShelter, enterShelter, shelterSlots } from "./shelter";
import { knownBlock } from "../core/primitives";
import { catalog } from "../core/catalog";
import { placeBlockResult } from "../actions/worldInteraction";

export type Milestone = {
  id: string;
  /** For chat: "stone tools". */
  title: string;
  tier: number;
  done: () => boolean;
  /** Gets it done (bounded; a failure says why). */
  achieve: () => Promise<ActionResult>;
};

const FOOD_STOCK = 20; // food points carried: a couple of days' eating

/** Gets each item in turn with the planner; stops at the first it can't get. */
async function getAll(items: string[]): Promise<ActionResult> {
  for (const item of items) {
    if (bot.inventory.items().some((i) => i.name === item)) continue;
    const result = await acquire(item, 1, liveWorld);
    if (!result.ok) return result;
  }
  return ok();
}

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
  return foodPoints() >= FOOD_STOCK ? ok() : fail("missing_items", `only ${foodPoints()} food points; no more animals or berries around`);
}

/** A bed: 3 wool of one colour (from sheep), crafted, put in its slot in the shelter, used (spawn point). */
async function getBed(): Promise<ActionResult> {
  if (!bot.inventory.items().some((i) => i.name.endsWith("_bed"))) {
    let wool = bestWool();
    if (!wool || wool[1] < 3) {
      const got = await acquire("white_wool", 3, liveWorld);
      wool = bestWool();
      if (!got.ok && (!wool || wool[1] < 3)) return fail("missing_items", "I need 3 wool of one colour for a bed (no sheep around)");
    }
    const made = await acquire(`${wool![0]}_bed`, 1, liveWorld);
    if (!made.ok) return made;
  }
  // In the shelter, in the bed's own spot (never the nearest bed: that may be the owner's)
  const inside = await enterShelter();
  if (!inside.ok) return inside;
  const slot = shelterSlots()?.bed;
  if (!slot) return fail("not_found", "no spot for a bed in the shelter");
  if (!catalog().isBed(knownBlock(slot)?.name ?? "")) {
    const bedItem = bot.inventory.items().find((i) => i.name.endsWith("_bed"));
    if (!bedItem) return fail("missing_items", "no bed to put down");
    // Placed from the stand cell, facing on: the head goes into the last row
    const placed = await placeBlockResult(bedItem.name, slot.x, slot.y, slot.z);
    if (!placed.ok) return placed;
  }
  const { execute: sleep } = await import("../commands/Sleep");
  await sleep({ newBed: false }); // its new bed is the nearest: uses it (by day too), so the spawn point is set
  return hasBed() ? ok() : fail("refused", "the bed didn't take (the server said no)");
}

/** Two chests in their spots in the shelter, with the cheap stuff put away in them. */
async function setUpChests(): Promise<ActionResult> {
  const slots = shelterSlots();
  if (!slots) return fail("not_found", "no shelter for the chests yet");
  const { lookInChest, storeItems } = await import("../actions/storage");
  const inside = await enterShelter();
  if (!inside.ok) return inside;
  for (const slot of slots.chests) {
    if (knownBlock(slot)?.name === "chest") continue;
    const got = await acquire("chest", 1, liveWorld);
    if (!got.ok) return got;
    const placed = await placeBlockResult("chest", slot.x, slot.y, slot.z);
    if (!placed.ok) return placed;
    const block = knownBlock(slot);
    if (block?.name === "chest") await lookInChest(block); // remembered from now on
  }
  await storeItems("lowValue");
  return chestsNear(slots.stand) >= 2 ? ok() : fail("refused", "the chests didn't stay");
}

/** Every milestone, in the order the bot goes for them. */
export const MILESTONES: Milestone[] = [
  {
    id: "wooden_tools",
    title: "wooden tools",
    tier: 1,
    done: () => toolTier("pickaxe") >= TIER.wooden && toolTier("sword") >= TIER.wooden,
    achieve: () => getAll(["wooden_pickaxe", "wooden_sword"]),
  },
  {
    id: "shelter",
    title: "a shelter",
    tier: 1,
    done: () => shelter() !== null,
    achieve: buildShelter,
  },
  {
    id: "stone_tools",
    title: "stone tools",
    tier: 1,
    done: () => toolTier("pickaxe") >= TIER.stone && toolTier("axe") >= TIER.stone && toolTier("sword") >= TIER.stone,
    achieve: () => getAll(["stone_pickaxe", "stone_sword", "stone_axe"]),
  },
  {
    id: "food",
    title: "a food stock",
    tier: 1,
    done: () => foodPoints() >= FOOD_STOCK,
    achieve: stockFood,
  },
  {
    id: "bed",
    title: "a bed",
    tier: 1,
    done: hasBed,
    achieve: getBed,
  },
  {
    id: "chests",
    title: "two chests with my things",
    tier: 1,
    done: () => {
      const room = shelter();
      return room !== null && chestsNear(room) >= 2;
    },
    achieve: setUpChests,
  },
];

/** The next milestone not done (and not blocked), Tier 1 first; null when Tier 1 is reached. */
export function nextMilestone(list: Milestone[], blocked: (id: string) => boolean = () => false): Milestone | null {
  return list.find((m) => m.tier === 1 && !m.done() && !blocked(m.id)) ?? null;
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
