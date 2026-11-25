// Path: src/commands/RecoverItems.ts

import { z } from "zod";
import { Vec3 } from "vec3";
import { tunnelTo } from "../actions/digging";
import { bot } from "../core/body";
import { goToPosition, LONG_TRIP_BLOCKS, travelTo } from "../actions/movement";
import { pickupNearbyItems } from "../actions/pickup";
import { canReachBeforeDespawn, clearLastDeath, getLastDeath } from "../actions/recovery";
import { isCommandCancelled } from "../core/commandContext";
import { tellOwner } from "../managers/ownerDialog";

export const description = `Goes back to where the bot last died and picks up its dropped items (they disappear
5 minutes after death). The bot also does this on its own after respawning.
Example: "Go get your stuff back", "Recover your items", "Get your things from where you died".`;

export const parameters = z.object({});

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
  if (!canReachBeforeDespawn(death)) {
    tellOwner(`My things at ${where} are too far away to reach before they disappear.`);
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
