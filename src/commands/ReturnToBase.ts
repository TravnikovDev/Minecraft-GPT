// Path: src/actions/ReturnToBase.ts

import { z } from "zod";
import { bot } from "../index";
import { goToPosition } from "../actions/movement";
import { getBaseLocation } from "../managers/persistenceManager";

export const description = `When user asks the bot to return to base, the bot will navigate back to the base location.
    Example: "Return to base", "Go back to the base", "Head home".
    If no parameters are provided, the bot will return to the default base location.`;

// Define parameters for ReturnToBase action
export const parameters = z.object({});

// Implement the ReturnToBase action
export async function execute() {
  try {
    const baseLocation = getBaseLocation();
    // Set the pathfinder goal to go back to the base
    if (baseLocation) {
      goToPosition(baseLocation?.x, baseLocation?.y, baseLocation?.z);
      bot.chat(`Returning to base!`);
    } else {
      bot.chat(`No base location found!`);
    }
  } catch (error) {
    bot.chat(`Error returning to base: ${error}`);
  }
}
