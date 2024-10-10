// Path: src/actions/DigDirectionalTunnel.ts

import { z } from "zod";
import { bot } from "../index";
import {
  breakBlockAt,
  pickupNearbyItems,
  placeBlock,
} from "../utils/worldInteraction";
import { craftRecipe } from "../utils/crafting";
import { __actionsDelay } from "../utils/utility";
import { Vec3 } from "vec3";

// Define parameters for DigDirectionalTunnel action
export const parameters = z.object({
  depth: z.number().optional().describe("Depth of the tunnel"),
  torchInterval: z.number().optional().describe("Interval for torch placement"),
  tunnelSize: z
    .object({
      width: z.number(),
      height: z.number(),
    })
    .optional()
    .describe("Dimensions of the tunnel"),
  direction: z
    .enum(["north", "south", "west", "east"])
    .optional()
    .describe("Tunnel direction"),
});

// Implement the DigDirectionalTunnel action
export async function execute(args: any) {
  console.log(`Executing DigDirectionalTunnel with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for DigDirectionalTunnel:`, parsed.error);
    return;
  }

  let { depth, torchInterval, tunnelSize, direction } = parsed.data;
  let startPosition = bot.entity.position.clone();

  // Default values for tunnel size
  depth = depth || 10;
  torchInterval = torchInterval || 12;
  tunnelSize = tunnelSize || { width: 3, height: 4 };
  direction = direction || "north";

  let reachedEnd = false;

  // Calculate directional offsets
  const offsetX = direction === "east" ? 1 : direction === "west" ? -1 : 0;
  const offsetZ = direction === "south" ? 1 : direction === "north" ? -1 : 0;

  // Dig the tunnel
  for (let w = 0; w < tunnelSize.width; w++) {
    // Width offsets based on direction
    const wOffsetX = direction === "north" || direction === "south" ? w : 0;
    const wOffsetZ = direction === "east" || direction === "west" ? w : 0;

    for (let i = 1; i <= depth; i++) {
      const basePosition = startPosition.offset(
        wOffsetX + i * offsetX,
        -i,
        wOffsetZ + i * offsetZ
      );

      console.log(`Digging at ${basePosition.toString()}`);

      // Dig the area for the tunnel
      for (let h = 0; h < tunnelSize.height; h++) {
        const digPosition = basePosition.offset(0, h, 0);

        const digResult = await breakBlockAt(
          digPosition.x,
          digPosition.y,
          digPosition.z
        );
        await __actionsDelay(digResult ? 3500 : 500);
      }

      await pickupNearbyItems(bot);

      // Place torch every `torchInterval` blocks
      if (i % torchInterval === 0 && w === Math.floor(tunnelSize.width / 2)) {
        const torchPosition = basePosition.offset(0, 1, 0);
        const torch = bot.inventory
          .items()
          .find((item) => item.name === "torch");
        if (torch) {
          const torchBlock = bot.blockAt(torchPosition);
          if (torchBlock) {
            await placeBlock(
              "wall_torch",
              torchPosition.x,
              torchPosition.y,
              torchPosition.z,
              "side"
            );
          }
          bot.chat(`Placed torch at ${torchPosition.toString()}`);
        } else {
          console.log("No torches found in inventory.");
          // TODO: Craft torches
        }
      }
    }
  }

  const cobblestoneCount = bot.inventory
    .items()
    .filter((item) => item.name.includes("cobblestone"))
    .reduce((acc, item) => acc + item.count, 0);

  const stairsNeeded = Math.floor(depth * tunnelSize.width);
  const cobblestonesNeeded = Math.ceil(stairsNeeded / 0.66);

  if (cobblestoneCount >= cobblestonesNeeded) {
    await craftRecipe("cobblestone_stairs", stairsNeeded);
    bot.chat(`Crafted ${stairsNeeded} cobblestone stairs.`);
  } else {
    bot.chat(
      `Not enough cobblestone! I have ${cobblestoneCount} and I need ${cobblestonesNeeded} blocks.`
    );
    // TODO: gatherCobblestone(cobblestonesNeeded - cobblestoneCount)
  }

  // Place stairs along the tunnel path
  for (let i = 1; i <= depth; i++) {
    for (let w = 0; w < tunnelSize.width; w++) {
      const wOffsetX = direction === "north" || direction === "south" ? w : 0;
      const wOffsetZ = direction === "east" || direction === "west" ? w : 0;

      const stairPosition = startPosition.offset(
        wOffsetX + i * offsetX,
        -i,
        wOffsetZ + i * offsetZ
      );

      const stairs = bot.inventory
        .items()
        .find((item) => item.name === "cobblestone_stairs");
      if (stairs) {
        const stairBlock = bot.blockAt(stairPosition);
        if (stairBlock) {
          await placeBlock(
            "cobblestone_stairs",
            stairPosition.x,
            stairPosition.y,
            stairPosition.z,
            "bottom"
          );
          bot.chat(`Placed cobblestone stair at ${stairPosition.toString()}`);
        } else {
          bot.chat(
            `Cannot place stair, no block found at ${stairPosition.toString()}`
          );
        }
      }
    }
  }

  bot.chat("Tunnel setup complete.");
}
