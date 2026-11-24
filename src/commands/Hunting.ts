// Path: src/commands/Hunting.ts

import { z } from "zod";
import { bot } from "../core/body";
import { Entity } from "prismarine-entity";
import { attackEntity } from "../actions/combat";
import { pickupNearbyItems } from "../actions/worldInteraction";
import { isCommandCancelled } from "../core/commandContext";
import { isHuntable } from "../utils/minecraftData";
import { fighting } from "../core/plugins";

export const description = `When user asks the bot to hunt, the bot finds the nearest animal (optionally of a given type),
kills it and picks up the drops, repeating for the requested number of animals.
Only for hunting animals; for food in general use gatherFood (farms first).
Example: "Hunt for animals within 10 blocks.", "Kill 3 sheep", "Kill the chicken", "Hunt for pigs".`;

// Define parameters for the Hunting action
export const parameters = z.object({
  maxDistance: z
    .number()
    .nullable()
    .describe("The maximum distance to hunt for animals (default 64)."),
  mobType: z
    .string()
    .nullable()
    .describe("Minecraft ID of the animal to hunt, e.g. sheep, cow, pig, chicken. Null for any huntable animal."),
  count: z.number().nullable().describe("How many animals to hunt (default 1)."),
});

const KILL_TIMEOUT_MS = 30000;

/** Nearest living animal that matches the requested type (or any huntable one). */
function findPrey(mobType: string | null, maxDistance: number): Entity | null {
  return bot.nearestEntity(
    (entity) =>
      (mobType ? entity.name === mobType : isHuntable(entity)) &&
      entity.position.distanceTo(bot.entity.position) < maxDistance
  );
}

/** Resolves when the entity is gone (killed), or false after the timeout or cancel. */
function waitUntilGone(target: Entity): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = setInterval(() => {
      const gone = !bot.entities[target.id];
      if (gone || isCommandCancelled() || Date.now() - started > KILL_TIMEOUT_MS) {
        clearInterval(check);
        if (!gone) fighting.stop();
        resolve(gone);
      }
    }, 250);
  });
}

// Implement the Hunting action
export async function execute(args: any): Promise<void> {
  console.log(`Executing Hunting with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for Hunting.`);
    return;
  }

  const maxDistance = parsed.data.maxDistance ?? 64;
  const mobType = parsed.data.mobType ?? null;
  const wanted = Math.max(1, parsed.data.count ?? 1);
  let killed = 0;

  for (let i = 0; i < wanted; i++) {
    if (isCommandCancelled()) return;
    const prey = findPrey(mobType, maxDistance);
    if (!prey) break;
    console.log(`Hunting ${prey.name}!`);
    const started = await attackEntity(prey);
    if (!started) break;
    if (await waitUntilGone(prey)) {
      killed++;
      await pickupNearbyItems(bot, 8);
    }
  }

  if (isCommandCancelled()) return;
  const what = mobType ? mobType.replace(/_/g, " ") : "animals";
  if (killed === 0) {
    bot.chat(`No ${what} nearby to hunt.`);
  } else if (killed < wanted) {
    bot.chat(`I could only find ${killed} of ${wanted} ${what}.`);
  } else {
    bot.chat(`Done hunting: ${killed} ${what}.`);
  }
}
