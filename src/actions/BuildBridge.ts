// Path: src/actions/BuildBridge.ts

import { z } from "zod";
import { BotActions } from "./types";
import { bot } from "../index";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { placeBlock } from "../utils/worldInteraction";

// Define parameters for BuildBridge action
export const parameters = z.object({
  destination: z
    .object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
    })
    .optional()
    .describe("Coordinates of the destination to reach"),
});

// Implement the BuildBridge action
export async function execute(args: any) {
  console.log(`Executing BuildBridge with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for BuildBridge:`, parsed.error);
    return;
  }

  const { destination } = parsed.data;
  const targetPosition = new Vec3(destination.x, destination.y, destination.z);

  // Check if the bot can pathfind to the destination
  bot.pathfinder.setGoal(
    new goals.GoalBlock(targetPosition.x, targetPosition.y, targetPosition.z)
  );
  bot.once("goal_reached", () => {
    bot.chat("Successfully reached the destination.");
  });

  bot.once("path_update", async (result) => {
    if (result.status === "noPath") {
      bot.chat(
        "No path available to the destination, attempting to build a bridge."
      );

      // Find the block with the highest count in inventory
      const blocks = bot.inventory
        .items()
        .filter(
          (item) =>
            item.name.includes("block") ||
            item.name.includes("stone") ||
            item.name.includes("dirt")
        );
      if (blocks.length === 0) {
        bot.chat("No suitable blocks available to build a bridge.");
        return;
      }

      const mostBlocks = blocks.reduce((prev, current) =>
        prev.count > current.count ? prev : current
      );
      bot.chat(`Using ${mostBlocks.name} to build a bridge.`);

      // Build the bridge towards the destination
      const currentPosition = bot.entity.position.clone();
      let nextPosition = currentPosition.clone();

      while (currentPosition.distanceTo(targetPosition) > 1) {
        nextPosition = currentPosition.offset(1, 0, 0); // Move one block forward on the X-axis
        const blockBelow = bot.blockAt(nextPosition.offset(0, -1, 0));

        if (blockBelow && blockBelow.name === "air") {
          const blockToPlaceOn = bot.blockAt(nextPosition.offset(0, -2, 0));
          if (blockToPlaceOn) {
            await placeBlock(
              mostBlocks.name,
              nextPosition.x,
              nextPosition.y,
              nextPosition.z,
              "bottom"
            );
          } else {
            bot.chat(
              `Cannot place block at ${nextPosition
                .offset(0, -2, 0)
                .toString()} as it is null.`
            );
          }
          bot.chat(`Placed ${mostBlocks.name} at ${nextPosition.toString()}`);
        }

        currentPosition.set(nextPosition.x, nextPosition.y, nextPosition.z);
      }

      bot.chat("Bridge completed, attempting to reach the destination again.");
      bot.pathfinder.setGoal(
        new goals.GoalBlock(
          targetPosition.x,
          targetPosition.y,
          targetPosition.z
        )
      );
    }
  });
}
