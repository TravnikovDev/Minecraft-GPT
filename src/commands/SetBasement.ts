// Path: src/actions/SetBasement.ts

import { z } from "zod";
import { Vec3 } from "vec3"; // Add this line to import Vec3
import { bot } from "../index";
import { digDiagonalTunnel } from "../actions/digDiagonalTunnel";
import { breakBlockAt, pickupNearbyItems } from "../actions/worldInteraction";
import {
  getBaseLocation,
  saveBasementLocation,
} from "../managers/persistenceManager";

export const description = `When user asks the bot to set up a basement, the bot will dig a diagonal tunnel down and 
create a room at the end of the tunnel. Example: "Set up a basement with a room size of 3x3x4",
"Please build a basement", "Let's build a basement".
If no parameters are provided, the bot will use default values 3x3x4 for room size.`;

// Define parameters for SetBasement action
export const parameters = z.object({
  // tunnelDepth: z.number().optional().describe("Depth of the diagonal tunnel"),
  roomSize: z
    .object({
      width: z.number(),
      height: z.number(),
      length: z.number(),
    })
    .describe("Dimensions of the basement room"),
});

// Implement the SetBasement action
export async function execute(args: any) {
  console.log(`Executing SetBasement with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for SetBasement:`, parsed.error);
    return;
  }

  let { roomSize } = parsed.data;
  const basementPosition = getBaseLocation();
  const startPosition = basementPosition
    ? new Vec3(
        basementPosition.x,
        basementPosition.y,
        basementPosition.z
      ).offset(6, 0, 0)
    : bot.entity.position.clone();
  let direction = "south";

  const offsetX = direction === "east" ? 1 : direction === "west" ? -1 : 0;
  const offsetZ = direction === "south" ? 1 : direction === "north" ? -1 : 0;

  // Default values for room size
  const tunnelDepth = 6;
  roomSize = roomSize || { width: 3, height: 3, length: 4 };

  await digDiagonalTunnel(
    direction as any,
    tunnelDepth,
    { width: 1, height: 4 },
    startPosition,
    "basementEntrance"
  );

  // Create the room at the end of the tunnel
  const roomStart = startPosition.offset(
    tunnelDepth * offsetX,
    -tunnelDepth,
    tunnelDepth * offsetZ
  );
  for (let x = 0; x < roomSize.width; x++) {
    for (let y = 0; y < roomSize.height; y++) {
      for (let z = 0; z < roomSize.length; z++) {
        const roomBlock = roomStart.offset(x, y, z);
        await breakBlockAt(roomBlock.x, roomBlock.y, roomBlock.z);
      }
    }
  }
  saveBasementLocation(roomStart);

  await pickupNearbyItems(bot);
  bot.chat("Room is dug out for the basement.");

  //   // Place essential items in the room
  //   async function placeItem(itemName: string, positionOffset: Vec3) {
  //     const item = bot.inventory.items().find((i) => i.name === itemName);
  //     if (item) {
  //       const targetPos = roomStart.offset(
  //         positionOffset.x,
  //         positionOffset.y,
  //         positionOffset.z
  //       );
  //       await bot.placeBlock(bot.blockAt(targetPos), item);
  //       bot.chat(`Placed ${itemName} in the basement.`);
  //     } else {
  //       bot.chat(`${itemName} is missing in inventory.`);
  //     }
  //   }

  //   // Place crafting table, chest, bed, and torch
  //   await placeItem("crafting_table", new Vec3(0, 0, 0));
  //   await placeItem("chest", new Vec3(1, 0, 0));
  //   await placeItem("bed", new Vec3(2, 0, 0));
  //   await placeItem("torch", new Vec3(1, 1, 1)); // Place torch on wall or ground

  // Craft and place door at room entrance
  //   const doorRecipe = bot.recipesFor("wooden_door", null, 1)[0];
  //   if (doorRecipe) {
  //     await bot.craft(doorRecipe, 1);
  //     const doorPos = startPosition.offset(
  //       tunnelDepth - 1,
  //       -tunnelDepth,
  //       tunnelDepth - 1
  //     );
  //     await bot.placeBlock(
  //       bot.blockAt(doorPos),
  //       bot.inventory.items().find((i) => i.name === "wooden_door")
  //     );
  //     bot.chat("Wooden door crafted and placed at the room entrance.");
  //   } else {
  //     bot.chat("No recipe found for wooden door.");
  //   }

  bot.chat("Basement setup complete.");
}
