// Path: src/actions/SetBase.ts

import { z } from "zod";
import { bot } from "../index";
import {
  getBaseLocation,
  saveBaseLocation,
} from "../managers/persistenceManager";
import { __actionsDelay } from "../utils/utility";
import { ensureLocation } from "../actions/ensureLocation";
import { ensureAxe, ensurePickaxe, ensureShovel } from "../actions/ensureTools";
import { buildShelter, clearSite, setupTheShelter } from "../actions/building";
import { goToPosition } from "../actions/movement";

export const description = `When user asks the bot to set a base location, the bot will mark the location as the base, 
clear the area around the bot for building, build basic structures, and place essential items. 
Example: "Set base location here", "Build a base here".`;

// Define parameters for SetBase action
export const parameters = z.object({
  baseName: z.string().describe("The name of the base location"),
});

// Implement the SetBase action
export async function execute(args: any) {
  console.log(`Executing SetBase with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for SetBase:`, parsed.error);
    return;
  }

  const { baseName } = parsed.data;

  if (!(await getBaseLocation())) {
    await ensureAxe(); // Ensure the bot has an axe to harvest a lot of wood
    const goodLocation = await ensureLocation();
    await goToPosition(goodLocation.x, goodLocation.y, goodLocation.z);
    const basePosition = goodLocation.offset(0, -1, 0);

    if (!goodLocation) {
      console.log(`Not a good location to set base.`);
      return;
    }

    // Placeholder: Mark the location as the base
    console.log(`Setting base with name "${baseName}".`);
    await saveBaseLocation(baseName, basePosition);

    // Clear the area around the bot for building
    bot.chat(`Clearing the area around the bot for building...`);
    await ensureShovel(); // Better to have a shovel to clear the area
    await ensurePickaxe(); // It could have some stone blocks, so we need a pickaxe
    await clearSite(basePosition);

    // Notify in chat
    bot.chat(
      `Base "${baseName}" set at location ${Math.floor(
        basePosition.x
      )}, ${Math.floor(basePosition.y)}, ${Math.floor(basePosition.z)}`
    );
  }

  try {
    await buildShelter();
    bot.chat("I've dug out the shelter ⾕");
    await __actionsDelay(3000);
    bot.chat(
      "Setting up the shelter... I'll craft chests and furnace and place them in the shelter."
    );
    await setupTheShelter();
    bot.chat("Shelter setup complete ⾕");
  } catch (error) {
    bot.chat(`Error during up basement: ${error}`);
  }
}
