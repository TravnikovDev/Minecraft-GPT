// Path: src/actions/SetBase.ts

import { z } from "zod";
import { bot } from "../index";
import {
  addCommandToQueue,
  saveBaseLocation,
} from "../managers/persistenceManager";
import { BotCommands } from "./types";
import { ensureLocation } from "../actions/ensure";
import { __actionsDelay } from "../utils/utility";
import { moveAway } from "../actions/movement";

export const description = `When user asks the bot to set a base location, the bot will mark the location as the base, 
clear the area around the bot for building, build basic structures, and place essential items. 
Example: "Set base location here", "Build a base here".`;

// TODO: Rework using db stored objects

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
  const basePosition = bot.entity.position;

  const goodLocation = await ensureLocation();

  if (!goodLocation) {
    console.log(`Not a good location to set base.`);
    return;
  }

  // Placeholder: Mark the location as the base
  console.log(
    `Setting base at position ${basePosition} with name "${baseName}".`
  );
  await saveBaseLocation(baseName, basePosition);

  // Placeholder: Clear area around the bot for building
  // TODO: Implement block clearing within the specified radius
  // console.log(`Clearing blocks in a ${radius}-block radius for base setup.`);
  // Example: Find and remove blocks in the radius

  // Notify in chat
  bot.chat(
    `Base "${baseName}" set at location ${Math.floor(
      basePosition.x
    )}, ${Math.floor(basePosition.y)}, ${Math.floor(basePosition.z)}`
  );

  await addCommandToQueue({
    id: "set-basement",
    command: BotCommands.SetBasement,
    priority: 6,
    args: { tunnelDepth: 6, roomSize: { width: 3, height: 3, length: 4 } },
    retryCount: 1,
  });
}
