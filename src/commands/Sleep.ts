// Path: src/commands/Sleep.ts

import { z } from "zod";
import { bot } from "../core/body";
import { goToPosition } from "../actions/movement";
import { findNearestBed, placeItemNear } from "../actions/placement";
import { isCommandCancelled } from "../core/commandContext";
import { tellOwner } from "../managers/ownerDialog";

export const description = `Goes to bed: uses a bed nearby, or places one from the inventory first, then sleeps
(sleeping skips the night when everyone sleeps and sets the bot's spawn point).
Use this for anything about beds and sleeping. Example: "Go to sleep", "Use the bed", "Sleep in your bed",
"Place your bed and sleep", "Set your spawn point".`;

export const parameters = z.object({});

/** Turns mineflayer's sleep errors into something friendly. */
function whyNoSleep(message: string): string {
  if (/night|thunderstorm|day/i.test(message)) return "I can only sleep at night or during a thunderstorm.";
  if (/monster/i.test(message)) return "There are monsters nearby, so I can't sleep.";
  if (/occupied/i.test(message)) return "Someone is already in that bed.";
  if (/far/i.test(message)) return "I couldn't get close enough to the bed.";
  return `I couldn't sleep: ${message}`;
}

export async function execute(): Promise<void> {
  if (bot.isSleeping) {
    bot.chat("I'm already in bed.");
    return;
  }

  let bed = findNearestBed(24);
  if (!bed) {
    const bedItem = bot.inventory.items().find((i) => i.name.endsWith("_bed"));
    if (!bedItem) {
      bot.chat("I don't have a bed. Say \"make me a bed\" and I'll craft one.");
      return;
    }
    tellOwner("Putting my bed down.");
    bed = await placeItemNear(bedItem.name);
    if (!bed) {
      bot.chat("I couldn't find a flat, free spot for my bed.");
      return;
    }
  }
  if (isCommandCancelled()) return;

  await goToPosition(bed.position.x, bed.position.y, bed.position.z, 2);
  if (isCommandCancelled()) return;

  const where = `${bed.position.x}, ${bed.position.y}, ${bed.position.z}`;
  try {
    await bot.sleep(bed);
    bot.chat("Good night! I'll wake up in the morning.");
  } catch (error) {
    const message = (error as Error).message;
    // mineflayer refuses daytime sleep without touching the bed, so the spawn
    // point is never set. Using the bed by day still sets it on the server.
    if (/not night/i.test(message)) {
      try {
        await bot.activateBlock(bed);
        bot.chat(`It's daytime, so I can't sleep yet, but I set my spawn point at my bed (${where}).`);
        return;
      } catch (activateError) {
        console.error("Using the bed to set the spawn point failed:", activateError);
      }
    }
    bot.chat(`${whyNoSleep(message)} My bed is at ${where}.`);
  }
}
