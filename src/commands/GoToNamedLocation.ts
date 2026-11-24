import { z } from "zod";
import { travelToResult } from "../actions/movement";
import { bot } from "../core/body";
import { describeFailure, wasStopped } from "../core/result";
import {
  getBasementLocation,
  getChests,
  getCraftingTables,
  getFurnaces,
  getMines,
} from "../managers/persistenceManager";

export const description = `When user asks the bot to go to a specific location, the bot will navigate to the specified place.
The bot can go to the base, basement, crafting table, furnace, chest, or mine.
Expected usage: "Go to the basement" or "Go to the crafting table" or "Go to the furnace" or "Go to the chest" or "Go to the mine".`;

// Define parameters for the GoToNamedLocation action
export const parameters = z.object({
  targetName: z.enum([
    "basement",
    "crafting table",
    "furnace",
    "chest",
    "mine",
  ]),
});

// Implement the GoToNamedLocation action
export async function execute(args: any) {
  console.log(`Executing GoToNamedLocation with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(
      `Missing or invalid parameters for GoToNamedLocation: targetName is undefined or incorrect.`
    );
    return;
  }

  let target = parsed.data.targetName;

  // Where the named place is, from what the bot remembers
  const p = (() => {
    switch (target) {
      case "basement":
        return getBasementLocation();
      case "crafting table":
        return getCraftingTables()?.[0];
      case "furnace":
        return getFurnaces()?.[0];
      case "chest":
        return getChests()?.[0]?.location;
      case "mine":
        return getMines()?.[0]?.startsAt;
      default:
        return undefined;
    }
  })();
  if (!p) {
    bot.chat(`I don't know where the ${target} is.`);
    return;
  }
  const result = await travelToResult(() => ({ x: p.x, y: p.y, z: p.z }), { range: 2 });
  if (result.ok) bot.chat(`I'm at the ${target}.`);
  else if (!wasStopped(result)) bot.chat(`I can't get to the ${target}: ${describeFailure(result)}.`);
}
