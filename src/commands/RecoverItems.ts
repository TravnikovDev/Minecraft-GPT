// Path: src/commands/RecoverItems.ts

import { z } from "zod";
import { Vec3 } from "vec3";
import { tunnelTo } from "../actions/digging";
import { bot } from "../core/body";
import { goToPosition, LONG_TRIP_BLOCKS, travelTo } from "../actions/movement";
import { pickupNearbyItems } from "../actions/pickup";
import { clearLastDeath, getLastDeath } from "../actions/recovery";
import { isCommandCancelled } from "../core/commandContext";
import { describeFailure } from "../core/result";
import { tellOwner } from "../managers/ownerDialog";

export const description = `Goes back to where the bot last died and picks up its dropped items (they disappear
5 minutes after death). The bot also does this on its own after respawning.
Example: "Go get your stuff back", "Recover your items", "Get your things from where you died".`;

export const parameters = z.object({});

/** A cell as the under-water check sees it (null: not loaded). */
export type WetCell = { water: boolean; solid: boolean } | null;

/**
 * True when the spot is under water with no air close over it: its feet
 * and head cells are water, and up the column there's water then something
 * solid (a ceiling) before any air. Pure over `look`.
 */
export function drownedUnderCeiling(look: (dy: number) => WetCell): boolean {
  if (!look(0)?.water || !look(1)?.water) return false;
  for (let dy = 2; dy <= 12; dy++) {
    const c = look(dy);
    if (!c) return false;
    if (c.solid) return true;
    if (!c.water) return false; // air above: it can come up for breath
  }
  return true;
}

// Within this of where it died: it got there
const THERE = 6;

/** A pickaxe to dig with: a stone one if it can, a wooden one from its planks otherwise. */
async function pickaxeToDig(): Promise<void> {
  const { toolTier } = await import("../skills/capabilities");
  if (toolTier("pickaxe") >= 0) return;
  const { acquire } = await import("../skills/acquire");
  const { liveWorld } = await import("../skills/world");
  const made = (await acquire("stone_pickaxe", 1, liveWorld)).ok || (await acquire("wooden_pickaxe", 1, liveWorld)).ok;
  console.log(made ? "Recovery: made a pickaxe to dig down to my things." : "Recovery: no pickaxe to dig with.");
}

const totalItems = (): number => bot.inventory.items().reduce((n, i) => n + i.count, 0);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function execute(): Promise<void> {
  const death = getLastDeath();
  if (!death) {
    bot.chat("I don't have anything to recover.");
    return;
  }
  const p = death.position;
  const where = `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;
  // Died in another dimension (Phase 9): the Nether is back through its
  // portal; the End's things are out of reach (the way back is long, and
  // they may have fallen into the void)
  const { dimensionNow, goToDimension } = await import("../skills/endgame/state");
  const diedIn = death.dimension.replace(/^minecraft:/, "");
  if (diedIn !== dimensionNow()) {
    if (diedIn === "the_end") {
      tellOwner(`I died in the End at ${where}; my things there are out of reach.`);
      clearLastDeath();
      return;
    }
    if (diedIn === "the_nether") {
      tellOwner(`I died in the Nether at ${where}. Going back through my portal for my things.`);
      const went = await goToDimension("the_nether");
      if (!went.ok) {
        tellOwner(`I can't get back to the Nether for my things: ${describeFailure(went)}.`);
        clearLastDeath();
        return;
      }
    }
  }
  // Always back for them, whatever the time, the water or the distance:
  // what it carried is hours of work (items on the ground only age while
  // their chunk is loaded, so far off they wait for it)
  const before = totalItems();
  const distance = Math.round(bot.entity.position.distanceTo(p));
  tellOwner(`I died at ${where}. Going back for my things (${distance} blocks).`);
  // Not empty-handed back into whatever killed it: a sword, a pickaxe (to
  // dig down to its things) and food from its chests, when they hold them
  await armFromChests();
  for (let attempt = 1; attempt <= RECOVERY_TRIES; attempt++) {
    if (isCommandCancelled()) return;
    if (await goBackOnce(p)) break;
    if (attempt < RECOVERY_TRIES) tellOwner(`Couldn't get to my things at ${where} yet; trying again (${attempt + 1} of ${RECOVERY_TRIES}).`);
  }
  if (isCommandCancelled()) return;
  await finishRecovery(death, where, before);
}

// Best first: what it takes from its chests for the trip back, one of each kind
const KIT: string[][] = [
  ["netherite_sword", "diamond_sword", "iron_sword", "stone_sword"],
  ["netherite_pickaxe", "diamond_pickaxe", "iron_pickaxe", "stone_pickaxe"],
  ["shield"],
];
const KIT_FOOD = ["cooked_beef", "cooked_porkchop", "cooked_mutton", "cooked_chicken", "bread", "baked_potato", "cooked_cod", "cooked_salmon"];

/** A sword, a pickaxe, a shield and some food from its chests near, for what it lacks. */
async function armFromChests(): Promise<void> {
  const { storedNear, takeItems } = await import("../actions/storage");
  const carries = (name: string): boolean => bot.inventory.items().some((i) => i.name === name);
  const wanted: Array<{ name: string; count: number }> = [];
  for (const kind of KIT) {
    if (kind.some(carries)) continue;
    const stored = kind.find((n) => storedNear(n, 32) > 0);
    if (stored) wanted.push({ name: stored, count: 1 });
  }
  if (!KIT_FOOD.some(carries)) {
    const food = KIT_FOOD.find((n) => storedNear(n, 32) > 0);
    if (food) wanted.push({ name: food, count: 8 });
  }
  if (wanted.length === 0) return;
  await takeItems(wanted, true);
  console.log(`Recovery: took ${wanted.map((w) => w.name.replace(/_/g, " ")).join(", ")} from my chests for the trip back.`);
}

// Goes back this many times before it says it couldn't get there
const RECOVERY_TRIES = 4;

/** One go at getting to where it died and picking up what's there. True when it got there. */
async function goBackOnce(p: { x: number; y: number; z: number }): Promise<boolean> {
  const distance = Math.round(bot.entity.position.distanceTo(new Vec3(p.x, p.y, p.z)));

  const arrived =
    distance > LONG_TRIP_BLOCKS
      ? await travelTo(() => ({ x: p.x, y: p.y, z: p.z }), {
          range: 2,
          onProgress: (percent) => tellOwner(`Going back for my things: ${percent}%.`),
        })
      : await goToPosition(p.x, p.y, p.z, 2);
  if (isCommandCancelled()) return false;

  // The long trip stops above the spot (it measures across, not down): died
  // in a cave below, so walk down to it, or tunnel down like a miner
  let reached = arrived;
  const below = new Vec3(p.x, p.y, p.z).floored();
  if (Math.abs(bot.entity.position.y - p.y) > 3) {
    reached = await goToPosition(p.x, p.y, p.z, 2);
    if (!reached && !isCommandCancelled()) {
      tellOwner(`I died down in a cave ${Math.round(bot.entity.position.y - p.y)} blocks below; digging down to my things.`);
      // A pickaxe first: its own is in the pile (game test: the tunnel
      // stopped at the first stone, "nothing I carry harvests stone")
      await pickaxeToDig();
      reached = await tunnelTo(below, "place where I died");
    }
    if (isCommandCancelled()) return false;
  }

  // A few passes: items scatter and some land a few blocks away
  for (let pass = 0; pass < 3; pass++) {
    await pickupNearbyItems(bot, 12);
    if (isCommandCancelled()) return false;
    await sleep(800);
  }
  return bot.entity.position.distanceTo(new Vec3(p.x, p.y, p.z)) <= THERE;
}

/** What it says (and whether it keeps the death) once it's done trying. */
async function finishRecovery(death: { position: { x: number; y: number; z: number } }, where: string, before: number): Promise<void> {
  const p = death.position;
  const gained = totalItems() - before;
  // Only there counts (game test: 79 blocks above its things it picked up 3
  // stray items, said "got my things back" and never went for them)
  const there = bot.entity.position.distanceTo(new Vec3(p.x, p.y, p.z)) <= THERE;
  if (!there && !isCommandCancelled()) {
    // Kept: asked again ("go get your stuff back"), it goes back for them
    tellOwner(`I couldn't get to my things at ${where}${gained > 0 ? ` (picked up ${gained} on the way)` : ""}; they're still there, and I'll go for them when I can.`);
    return;
  }
  clearLastDeath();
  if (gained > 0) {
    tellOwner(`Got my things back (${gained} items).`);
  } else if (there) {
    tellOwner("I couldn't find my things here; they may have burned or despawned.");
  } else {
    tellOwner("I couldn't get back to where I died.");
  }
}
