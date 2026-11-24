// Path: src/actions/ReturnToBase.ts

import { z } from "zod";
import { bot } from "../core/body";
import { travelToResult } from "../actions/movement";
import { describeFailure, wasStopped } from "../core/result";
import { getBaseLocation } from "../managers/persistenceManager";

export const description = `When user asks the bot to return to base, the bot will navigate back to the base location.
    Example: "Return to base", "Go back to the base", "Head home".
    If no parameters are provided, the bot will return to the default base location.`;

// Define parameters for ReturnToBase action
export const parameters = z.object({});

// Implement the ReturnToBase action
export async function execute() {
  const base = getBaseLocation();
  if (!base) {
    bot.chat(`No base location found!`);
    return;
  }
  bot.chat(`Returning to base!`);
  const result = await travelToResult(() => ({ x: base.x, y: base.y, z: base.z }), { range: 2 });
  if (result.ok) bot.chat("I'm back at the base.");
  else if (!wasStopped(result)) bot.chat(`I couldn't get back to the base: ${describeFailure(result)}.`);
}
