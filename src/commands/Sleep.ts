// Path: src/commands/Sleep.ts

import { z } from "zod";
import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { goToPosition, travelTo } from "../actions/movement";
import { findNearestBed, placeItemNear } from "../actions/placement";
import { loadBed, saveBed } from "../core/session";
import { isCommandCancelled } from "../core/commandContext";
import { tellOwner } from "../managers/ownerDialog";

export const description = `Goes to bed and sleeps (sleeping skips the night and sets the bot's spawn point).
The bot remembers its own bed and goes back to it; with no bed of its own it uses the nearest one, or places one
from its inventory. Use this for anything about beds and sleeping. Example: "Go to sleep", "Go to your bed",
"Sleep in your bed", "Place your bed and sleep", "Set your spawn point", "This is your bed now".`;

export const parameters = z.object({
  newBed: z
    .boolean()
    .nullable()
    .describe(
      "True when the owner points the bot to a new bed (\"use this bed\", \"this is your bed now\", \"set your bed here\"): the nearest bed becomes its own. Null otherwise."
    ),
});

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
async function useBedByDay(bed: Block, where: string): Promise<{ text: string; spawnSet: boolean }> {
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
  return {
    text: key ? BED_REPLIES[key]!(where) : `I tried my bed (${where}), but the server didn't answer, so my spawn point may not be set.`,
    // The server sets the spawn point before it says "only at night"
    spawnSet: key === "block.minecraft.set_spawn" || key === "block.minecraft.bed.no_sleep",
  };
}

/** Remembers this bed as the bot's own (its spawn point). */
async function rememberBed(bed: Block): Promise<void> {
  const p = bed.position;
  await saveBed({ x: p.x, y: p.y, z: p.z, dimension: bot.game.dimension, at: Date.now() });
}

const isBed = (block: Block | null): block is Block => Boolean(block?.name.endsWith("_bed"));

/**
 * The bot's own bed: walks back to it if it's far. Returns the bed, null when
 * it has none, or "gone" when the bed is no longer there (forgotten).
 */
async function ownBed(): Promise<Block | null | "gone"> {
  const saved = loadBed();
  if (!saved || saved.dimension !== bot.game.dimension) return null;
  const spot = { x: saved.x, y: saved.y, z: saved.z };
  const here = bot.blockAt(new Vec3(saved.x, saved.y, saved.z));
  if (here && !isBed(here)) {
    await saveBed(null);
    return "gone";
  }
  if (!here || bot.entity.position.distanceTo(new Vec3(saved.x, saved.y, saved.z)) > 24) {
    tellOwner(`Heading to my bed at ${saved.x}, ${saved.y}, ${saved.z}.`);
    await travelTo(() => spot, { range: 3 });
    if (isCommandCancelled()) return null;
  }
  const bed = bot.blockAt(new Vec3(saved.x, saved.y, saved.z));
  if (isBed(bed)) return bed;
  await saveBed(null);
  return "gone";
}

export async function execute(args: any = {}): Promise<void> {
  if (bot.isSleeping) {
    bot.chat("I'm already in bed.");
    return;
  }
  const parsed = parameters.safeParse(args);
  const newBed = parsed.success && parsed.data.newBed === true;

  // Its own bed first; the nearest bed only without one (or when told to)
  let bed: Block | null = null;
  if (!newBed) {
    const own = await ownBed();
    if (isCommandCancelled()) return;
    if (own === "gone") tellOwner("My bed is gone, so I'll find another one.");
    else bed = own;
  }
  bed ??= findNearestBed(24);
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

  if (!(await goToPosition(bed.position.x, bed.position.y, bed.position.z, 2))) {
    bot.chat(`I can't find a way to the bed at ${bed.position.x}, ${bed.position.y}, ${bed.position.z} without breaking anything.`);
    return;
  }
  if (isCommandCancelled()) return;

  const where = `${bed.position.x}, ${bed.position.y}, ${bed.position.z}`;
  try {
    await bot.sleep(bed);
    await rememberBed(bed);
    bot.chat("Good night! I'll wake up in the morning.");
  } catch (error) {
    const message = (error as Error).message;
    // mineflayer refuses daytime sleep without touching the bed, so the spawn
    // point is never set. Using the bed by day still sets it on the server.
    if (/not night/i.test(message)) {
      const result = await useBedByDay(bed, where);
      if (result.spawnSet) await rememberBed(bed);
      bot.chat(result.text);
      return;
    }
    bot.chat(`${whyNoSleep(message)} My bed is at ${where}.`);
  }
}
