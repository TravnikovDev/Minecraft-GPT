// Path: src/commands/Sleep.ts

import { z } from "zod";
import type { Block } from "prismarine-block";
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

// What the server answers when a bed is used (translation keys), and what the
// bot should tell the owner. "Respawn point set" only comes when the spawn
// point changes; "only at night" comes after the spawn point was set, so it
// also means the bed is the spawn point (maybe already).
const BED_REPLIES: Record<string, (where: string) => string> = {
  "block.minecraft.set_spawn": (w) => `It's daytime, so I can't sleep yet, but my spawn point is now my bed (${w}).`,
  "block.minecraft.bed.no_sleep": (w) => `It's daytime, so I can't sleep yet. My spawn point is my bed (${w}).`,
  "block.minecraft.bed.too_far_away": (w) => `I'm too far from my bed (${w}) to use it.`,
  "block.minecraft.bed.obstructed": (w) => `My bed (${w}) is blocked, so I can't use it.`,
  "block.minecraft.bed.occupied": (w) => `Someone is in my bed (${w}).`,
  "block.minecraft.bed.not_safe": () => "There are monsters nearby, so I can't use the bed.",
};

/**
 * Uses the bed by day (mineflayer's sleep refuses without touching it) and
 * reports what the server said, so the bot never claims a spawn point it
 * didn't get.
 */
async function useBedByDay(bed: Block, where: string): Promise<string> {
  const replies: string[] = [];
  const onMessage = (msg: { translate?: string }): void => {
    if (msg.translate && msg.translate in BED_REPLIES) replies.push(msg.translate);
  };
  bot.on("message", onMessage);
  try {
    await bot.lookAt(bed.position.offset(0.5, 0.5, 0.5), true);
    await bot.activateBlock(bed);
    await new Promise((r) => setTimeout(r, 1500));
  } catch (error) {
    console.error("Using the bed failed:", error);
  } finally {
    bot.off("message", onMessage);
  }
  console.log(`Bed replies from the server: ${replies.join(", ") || "none"}`);
  // "Respawn point set" wins over the night notice that comes with it
  const key = replies.includes("block.minecraft.set_spawn") ? "block.minecraft.set_spawn" : replies[0];
  return key ? BED_REPLIES[key]!(where) : `I tried my bed (${where}), but the server didn't answer, so my spawn point may not be set.`;
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
      bot.chat(await useBedByDay(bed, where));
      return;
    }
    bot.chat(`${whyNoSleep(message)} My bed is at ${where}.`);
  }
}
