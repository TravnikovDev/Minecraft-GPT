// Path: src/actions/SetBasement.ts

import { z } from "zod";
import { Vec3 } from "vec3";
import { bot } from "../index";
import {
  digDiagonalTunnel,
  type DirectionType,
} from "../actions/digDiagonalTunnel";
import {
  breakBlockAt,
  pickupNearbyItems,
  placeBlock,
} from "../actions/worldInteraction";
import {
  getBaseLocation,
  saveBasementLocation,
} from "../managers/persistenceManager";
import { ensurePickaxe } from "../actions/ensure";
// import { ensurePickaxe } from "../actions/ensureItems";
// import { ensureShovel } from "../actions/ensureItems"; // Implement this function as needed
// import { ensureDoor } from "../actions/ensureItems"; // Implement this function as needed
// import { Block } from "prismarine-block";

export const description = `When the user asks the bot to set up a basement, the bot will dig a diagonal tunnel down and 
create a room at the end of the tunnel. Example: "Set up a basement with a room size of 3x3x4",
"Please build a basement", "Let's build a basement".
If no parameters are provided, the bot will use default values 3x3x4 for room size.`;

// Define parameters for SetBasement action
export const parameters = z.object({
  roomSize: z
    .object({
      width: z.number(),
      height: z.number(),
      length: z.number(),
    })
    .optional()
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

  // Default values for room size
  roomSize = roomSize || { width: 3, height: 3, length: 4 };
  const tunnelDepth = 6; // Adjust as needed

  const basementPosition = getBaseLocation();
  const startPosition = basementPosition
    ? new Vec3(
        basementPosition.x,
        basementPosition.y,
        basementPosition.z
      ).offset(4, 0, 0)
    : bot.entity.position.clone();
  let direction = "south" as DirectionType;

  /*   // Direction the bot is facing
  const yaw = bot.entity.yaw;
  let direction: "north" | "south" | "east" | "west";

  if (yaw >= -Math.PI / 4 && yaw < Math.PI / 4) {
    direction = "south";
  } else if (yaw >= Math.PI / 4 && yaw < (3 * Math.PI) / 4) {
    direction = "west";
  } else if (yaw >= -(3 * Math.PI) / 4 && yaw < -Math.PI / 4) {
    direction = "east";
  } else {
    direction = "north";
  } */

  const offsetX = direction === "east" ? 1 : direction === "west" ? -1 : 0;
  const offsetZ = direction === "south" ? 1 : direction === "north" ? -1 : 0;

  await ensurePickaxe();
  // await ensureShovel(); // Ensure the bot has a shovel for digging dirt

  // Dig the diagonal tunnel
  await digDiagonalTunnel(
    direction,
    tunnelDepth,
    { width: 1, height: 4 },
    startPosition,
    "basementEntrance"
  );

  // Build a doorway at the entrance to basement (end of tunnel)
  const doorwayPosition = startPosition.offset(
    tunnelDepth * offsetX,
    -tunnelDepth,
    tunnelDepth * offsetZ
  );

  await buildDoorway(doorwayPosition, direction);

  // **4. Offset room to make tunnel at the center**
  // Adjust roomStart position to center the tunnel
  const roomStart = doorwayPosition.offset(
    offsetX * 2 - offsetZ,
    0,
    offsetZ * 2 - offsetX
  );

  // Create the room at the end of the tunnel
  await digRoom(roomStart, roomSize);

  // **6. Make a doorway on another side of the room and dig a mine**
  // const mineEntrancePosition = doorwayPosition.offset(
  //   offsetX * roomSize.length,
  //   0,
  //   offsetZ * roomSize.length
  // );
  // await buildDoorway(mineEntrancePosition, direction);
  // await digStraightTunnel(
  //   direction,
  //   10, // Length of the mine tunnel
  //   mineEntrancePosition
  // );

  saveBasementLocation(roomStart);

  await pickupNearbyItems(bot);
  bot.chat("Basement setup complete.");
}

// Helper function to dig the room
async function digRoom(
  roomStart: Vec3,
  roomSize: { width: number; height: number; length: number }
) {
  for (let x = 0; x < roomSize.width; x++) {
    for (let y = 0; y < roomSize.height; y++) {
      for (let z = 0; z < roomSize.length; z++) {
        const roomBlock = roomStart.offset(x, y, z);
        await breakBlockAt(roomBlock.x, roomBlock.y, roomBlock.z);
      }
    }
  }
}

// Helper function to build a doorway
async function buildDoorway(position: Vec3, direction: string) {
  // await ensureDoor(); // Ensure the bot has a door

  const offsetX = direction === "east" ? 1 : direction === "west" ? -1 : 0;
  const offsetZ = direction === "south" ? 1 : direction === "north" ? -1 : 0;

  // Clear the doorway space (2 blocks high)
  for (let y = 0; y < 2; y++) {
    const doorwayBlock = position.offset(offsetX, y, offsetZ);
    await breakBlockAt(doorwayBlock.x, doorwayBlock.y, doorwayBlock.z);
  }

  // Place the door
  // await placeBlock("wooden_door", position.x, position.y, position.z);
}

// Helper function to dig a straight tunnel
async function digStraightTunnel(
  direction: "north" | "south" | "east" | "west",
  length: number,
  startPosition: Vec3
) {
  const offsetX = direction === "east" ? 1 : direction === "west" ? -1 : 0;
  const offsetZ = direction === "south" ? 1 : direction === "north" ? -1 : 0;

  for (let i = 1; i <= length; i++) {
    const position = startPosition.offset(offsetX * i, 0, offsetZ * i);
    // Dig out a 2x2 tunnel
    for (let y = 0; y < 2; y++) {
      for (let x = -1; x <= 1; x++) {
        const blockPos = position.offset(x, y, 0);
        await breakBlockAt(blockPos.x, blockPos.y, blockPos.z);
      }
    }
  }
}
