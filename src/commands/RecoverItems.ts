// Path: src/commands/RecoverItems.ts

import { z } from "zod";
import { Vec3 } from "vec3";
import { tunnelTo } from "../actions/digging";
import { bot } from "../core/body";
import { goToPosition, LONG_TRIP_BLOCKS, travelTo } from "../actions/movement";
import { pickupNearbyItems } from "../actions/pickup";
import { canReachBeforeDespawn, clearLastDeath, getLastDeath } from "../actions/recovery";
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

/** The live check at where it died. */
function underWaterThere(p: { x: number; y: number; z: number }): boolean {
  const at = new Vec3(p.x, p.y, p.z).floored();
  return drownedUnderCeiling((dy) => {
    const b = bot.blockAt(at.offset(0, dy, 0));
    if (!b) return null;
    return { water: b.name === "water" || b.name === "bubble_column", solid: b.boundingBox === "block" };
  });
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
  if (!canReachBeforeDespawn(death)) {
    tellOwner(`My things at ${where} are too far away to reach before they disappear.`);
    clearLastDeath();
    return;
  }

  // Under water with no air over it (it drowned there): left, not dived for
  // (game test: it drowned in its flooded mine, went back for its things,
  // and drowned again in the same water a minute later)
  if (underWaterThere(p)) {
    tellOwner(`My things at ${where} are under water where I drowned; I'm leaving them rather than drown again.`);
    clearLastDeath();
    return;
  }

  const before = totalItems();
  const distance = Math.round(bot.entity.position.distanceTo(p));
  tellOwner(`I died at ${where}. Going back for my things (${distance} blocks).`);

  const arrived =
    distance > LONG_TRIP_BLOCKS
      ? await travelTo(() => ({ x: p.x, y: p.y, z: p.z }), {
          range: 2,
          onProgress: (percent) => tellOwner(`Going back for my things: ${percent}%.`),
        })
      : await goToPosition(p.x, p.y, p.z, 2);
  if (isCommandCancelled()) return;

  // The long trip stops above the spot (it measures across, not down): died
  // in a cave below, so walk down to it, or tunnel down like a miner
  let reached = arrived;
  const below = new Vec3(p.x, p.y, p.z).floored();
  if (Math.abs(bot.entity.position.y - p.y) > 3) {
    reached = await goToPosition(p.x, p.y, p.z, 2);
    if (!reached && !isCommandCancelled()) {
      tellOwner(`I died down in a cave ${Math.round(bot.entity.position.y - p.y)} blocks below; digging down to my things.`);
      reached = await tunnelTo(below, "place where I died");
    }
    if (isCommandCancelled()) return;
  }

  // A few passes: items scatter and some land a few blocks away
  for (let pass = 0; pass < 3; pass++) {
    await pickupNearbyItems(bot, 12);
    if (isCommandCancelled()) return;
    await sleep(800);
  }

  const gained = totalItems() - before;
  clearLastDeath();
  if (gained > 0) {
    tellOwner(`Got my things back (${gained} items).`);
  } else if (reached) {
    tellOwner("I couldn't find my things here; they may have burned or despawned.");
  } else {
    tellOwner("I couldn't get back to where I died.");
  }
}
