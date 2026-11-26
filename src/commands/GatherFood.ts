// Path: src/commands/GatherFood.ts

import { z } from "zod";
import { bot } from "../core/body";
import { harvestCrops } from "../actions/farming";
import { foodCount } from "../actions/recovery";
import { craftNow } from "../actions/craftPlanner";
import { isCommandCancelled } from "../core/commandContext";
import { tellOwner } from "../managers/ownerDialog";
import { execute as hunt } from "./Hunting";
import { cookFood, hasCookingSpot, rawFoodInInventory } from "../actions/cooking";

export const description = `Gets food: harvests ripe crops and berries on farms nearby first (replanting them),
bakes wheat into bread, and only hunts animals if that wasn't enough.
Use this for any general request for food. Example: "Collect some food", "Get 10 pieces of food", "We need food",
"Find something to eat".`;

export const parameters = z.object({
  count: z.number().nullable().describe("How many pieces of food to have when done (default 10)."),
});

const wheatCount = (): number =>
  bot.inventory.items().filter((i) => i.name === "wheat").reduce((n, i) => n + i.count, 0);

/** Bakes all the wheat it can into bread (3 wheat each). */
async function bakeBread(): Promise<void> {
  const loaves = Math.floor(wheatCount() / 3);
  if (loaves > 0) await craftNow("bread", loaves);
}

export async function execute(args: any): Promise<void> {
  const parsed = parameters.safeParse(args);
  const wanted = (parsed.success ? parsed.data.count : null) ?? 10;
  const start = foodCount();
  const target = start + wanted;
  // Wheat counts as a third of a loaf until it's baked
  const enough = (): boolean => foodCount() + Math.floor(wheatCount() / 3) >= target;

  const harvested = await harvestCrops({ enough });
  if (harvested > 0) tellOwner(`Harvested ${harvested} crops.`);
  await bakeBread();

  if (!enough() && !isCommandCancelled()) {
    const missing = target - foodCount();
    tellOwner(harvested > 0 ? `Still need ${missing} more food; going hunting.` : "No ripe crops nearby; going hunting.");
    await hunt({ maxDistance: 64, mobType: null, count: Math.ceil(missing / 2), walkFar: null });
  }

  // Raw meat is poor food: cook it if there's a campfire or furnace around
  if (rawFoodInInventory().length > 0 && hasCookingSpot() && !isCommandCancelled()) {
    const cooked = await cookFood();
    if (cooked) tellOwner(`Cooked ${cooked} food.`);
  }

  const got = foodCount() - start;
  bot.chat(got > 0 ? `Got ${got} food. I have ${foodCount()} now.` : "I couldn't find any food nearby.");
}
