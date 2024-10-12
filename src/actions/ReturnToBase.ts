// Path: src/actions/ReturnToBase.ts

import { z } from "zod";
import { bot } from "../index";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";

// TODO: Rework using objects stored in db

export const description = `When user asks the bot to return to base, the bot will navigate back to the base location.
    Example: "Return to base", "Go back to the base", "Head home".
    If no parameters are provided, the bot will return to the default base location.`;

// Define parameters for ReturnToBase action
export const parameters = z.object({
  baseLocation: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
      z: z.number().optional(),
    })
    .optional()
    .describe("Coordinates of the base to return to"),
});

// Implement the ReturnToBase action
export async function execute(args: any) {
  console.log(`Executing ReturnToBase with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for ReturnToBase:`, parsed.error);
    return;
  }

  const { baseLocation } = parsed.data;
  if (!baseLocation) {
    console.error("Base location is not defined.");
    return;
  }

  const targetPosition = new Vec3(
    baseLocation.x ?? 0,
    baseLocation.y ?? 0,
    baseLocation.z ?? 0
  );

  // Set the pathfinder goal to go back to the base
  bot.pathfinder.setGoal(
    new goals.GoalBlock(targetPosition.x, targetPosition.y, targetPosition.z)
  );
  bot.chat(`Returning to base at ${targetPosition.toString()}`);
}

// Event listener for death
// bot.on("death", () => {
//   console.log("Bot has died. Respawning...");
//   bot.once("respawn", () => {
//     bot.chat("I've respawned. Heading back to base.");
//     execute({
//       baseLocation: { x: 100, y: 64, z: 100 }, // Replace with actual base coordinates
//     }); // Replace with actual base coordinates
//   });
// });
