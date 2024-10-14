// Path: src/actions/SetBaseLocation.ts

import { z } from "zod";
import { bot } from "../index";

export const description = `When user asks the bot to set a base location, the bot will mark the location as the base, 
clear the area around the bot for building, build basic structures, and place essential items. 
Example: "Set base location here", "Build a base here".`;

// TODO: Rework using db stored objects

// Define parameters for SetBaseLocation action
export const parameters = z.object({
  baseName: z.string().describe("The name of the base location"),
  radius: z.number().describe("Radius around the bot for base setup"),
});

// Implement the SetBaseLocation action
export async function execute(args: any) {
  console.log(`Executing SetBaseLocation with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for SetBaseLocation:`, parsed.error);
    return;
  }

  const { baseName, radius } = parsed.data;
  const basePosition = bot.entity.position;

  // Placeholder: Mark the location as the base
  // TODO: Store the base coordinates and associate it with `baseName`
  console.log(
    `Setting base at position ${basePosition} with name "${baseName}".`
  );
  // Example: Store base location in a global or bot-specific variable

  // Placeholder: Clear area around the bot for building
  // TODO: Implement block clearing within the specified radius
  console.log(`Clearing blocks in a ${radius}-block radius for base setup.`);
  // Example: Find and remove blocks in the radius

  // Notify in chat
  bot.chat(
    `Base "${baseName}" set at location ${Math.floor(
      basePosition.x
    )}, ${Math.floor(basePosition.y)}, ${Math.floor(basePosition.z)}`
  );
}
