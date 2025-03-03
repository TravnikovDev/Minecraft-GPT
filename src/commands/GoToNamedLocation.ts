import { z } from "zod";
import { goToPosition } from "../actions/movement";
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

  switch (target) {
    case "basement":
      const basementLocation = getBasementLocation();
      if (basementLocation)
        await goToPosition(
          basementLocation.x,
          basementLocation.y,
          basementLocation.z
        );
      break;
    case "crafting table":
      const craftingTableLocation = getCraftingTables();
      if (craftingTableLocation?.length)
        await goToPosition(
          craftingTableLocation[0].x,
          craftingTableLocation[0].y,
          craftingTableLocation[0].z
        );
      break;
    case "furnace":
      const furnaceLocations = getFurnaces();
      if (furnaceLocations?.length)
        await goToPosition(
          furnaceLocations[0].x,
          furnaceLocations[0].y,
          furnaceLocations[0].z
        );
      break;
    case "chest":
      const chestLocations = getChests();
      if (chestLocations?.length)
        await goToPosition(
          chestLocations[0].location.x,
          chestLocations[0].location.y,
          chestLocations[0].location.z
        );
      break;
    case "mine":
      const minesLocations = getMines();
      if (minesLocations?.length)
        await goToPosition(
          minesLocations[0].startsAt.x,
          minesLocations[0].startsAt.y,
          minesLocations[0].startsAt.z
        );
      break;
    default:
      console.error(`Invalid target name for GoToNamedLocation: ${target}`);
  }
}
