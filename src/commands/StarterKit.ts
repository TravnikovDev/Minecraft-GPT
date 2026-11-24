// Path: src/commands/StarterKit.ts

import { z } from "zod";
import { bot } from "../core/body";
import { craftNow } from "../actions/craftPlanner";
import { gatherWood } from "../actions/gatherWood";
import { goToPosition } from "../actions/movement";
import { pickupNearbyItems } from "../actions/worldInteraction";
import { foodCount, hasPickaxe, hasWeapon } from "../actions/recovery";
import { execute as hunt } from "./Hunting";
import { isCommandCancelled } from "../core/commandContext";
import { tellOwner } from "../managers/ownerDialog";

export const description = `Gets basic gear when the bot has little or nothing: a wooden sword and pickaxe
(gathering wood itself if needed) and some food (sweet berries or hunting nearby animals). It does this on its own
after respawning empty-handed. Example: "Get some basic gear", "Make yourself some tools", "You need food".`;

export const parameters = z.object({});

const MIN_FOOD = 4;

/** Makes a wooden tool, gathering logs first if that's all that is missing. */
async function makeWoodenTool(item: string): Promise<boolean> {
  let result = await craftNow(item, 1);
  if (result.ok) return true;
  const logs = result.missing.find((m) => m.name === "logs");
  if (logs && result.missing.length === 1) {
    await gatherWood(Math.max(logs.count, 2), 64);
    if (isCommandCancelled()) return false;
    result = await craftNow(item, 1);
  }
  return result.ok;
}

/** Harvests ripe sweet berry bushes nearby (right-click), then picks up the berries. */
async function pickBerries(): Promise<void> {
  const bushId = bot.registry.blocksByName["sweet_berry_bush"]?.id;
  if (bushId === undefined) return;
  const spots = bot.findBlocks({ matching: bushId, maxDistance: 24, count: 6 });
  for (const spot of spots) {
    if (isCommandCancelled() || foodCount() >= MIN_FOOD) return;
    const bush = bot.blockAt(spot);
    const age = Number(bush?.getProperties()?.["age"] ?? 0);
    if (!bush || age < 2) continue; // not ripe
    await goToPosition(spot.x, spot.y, spot.z, 2);
    try {
      await bot.activateBlock(bush);
    } catch (error) {
      console.log(`Couldn't pick berries: ${(error as Error).message}`);
    }
    await pickupNearbyItems(bot, 4);
  }
}

export async function execute(): Promise<void> {
  const needWeapon = !hasWeapon();
  const needPickaxe = !hasPickaxe();
  const needFood = foodCount() < MIN_FOOD;
  if (!needWeapon && !needPickaxe && !needFood) {
    bot.chat("I already have basic gear.");
    return;
  }

  const todo = [needWeapon && "a wooden sword", needPickaxe && "a wooden pickaxe", needFood && "some food"]
    .filter(Boolean)
    .join(", ");
  tellOwner(`Getting basic gear: ${todo}.`);

  if (needWeapon) await makeWoodenTool("wooden_sword");
  if (isCommandCancelled()) return;
  if (needPickaxe) await makeWoodenTool("wooden_pickaxe");
  if (isCommandCancelled()) return;

  if (foodCount() < MIN_FOOD) await pickBerries();
  if (isCommandCancelled()) return;
  if (foodCount() < MIN_FOOD) await hunt({ maxDistance: 48, mobType: null, count: 2 });
  if (isCommandCancelled()) return;

  const parts = [
    hasWeapon() ? "a weapon" : "no weapon",
    hasPickaxe() ? "a pickaxe" : "no pickaxe",
    `${foodCount()} food`,
  ];
  tellOwner(`Basic gear done: ${parts.join(", ")}.`);
}
