import { bot } from "../index";
import {
  breakBlockAt,
  pickupNearbyItems,
  placeBlock,
} from "../actions/worldInteraction";
import { __actionsDelay } from "../utils/utility";
import { saveMineLocation } from "../managers/persistenceManager";
import { Vec3 } from "vec3";
import { getItemCount } from "./inventory";
import { ensurePlanks } from "./ensure";

export type DirectionType = "north" | "south" | "west" | "east";

/**
 * Digs a diagonal tunnel in the specified direction.
 * @param direction The direction to dig the tunnel in.
 * @param depth The depth of the tunnel.
 * @param tunnelSize The size of the tunnel.
 * @param torchInterval The interval at which to place torches.
 * @returns A promise that resolves to a boolean indicating whether the tunnel was successfully dug.
 */
export async function digDiagonalTunnel(
  direction: DirectionType = "north",
  depth: number = 10,
  tunnelSize: { width: number; height: number } = { width: 1, height: 4 },
  startPosition?: Vec3,
  tunnelName: string = `Tunnel-${direction}-${depth}`,
  torchInterval: number = 12
): Promise<boolean> {
  if (!startPosition) startPosition = bot.entity.position.clone();

  const offsetX = direction === "east" ? 1 : direction === "west" ? -1 : 0;
  const offsetZ = direction === "south" ? 1 : direction === "north" ? -1 : 0;

  for (let w = 0; w < tunnelSize.width; w++) {
    const wOffsetX = direction === "north" || direction === "south" ? w : 0;
    const wOffsetZ = direction === "east" || direction === "west" ? w : 0;

    for (let i = 0; i <= depth; i++) {
      const basePosition = startPosition.offset(
        wOffsetX + i * offsetX,
        -i,
        wOffsetZ + i * offsetZ
      );

      for (let h = 0; h < tunnelSize.height; h++) {
        const digPosition = basePosition.offset(0, h, 0);
        const digResult = await breakBlockAt(
          digPosition.x,
          digPosition.y,
          digPosition.z
        );
        await __actionsDelay(digResult ? 1000 : 200);

        // After digging the floor block, ensure there is a foundation
        if (h === 0) {
          await ensureFoundation(basePosition);
        }
      }

      await pickupNearbyItems(bot);

      if (i % torchInterval === 0 && w === tunnelSize.width - 1) {
        const torchPosition = basePosition.offset(0, 2, 0);
        const torch = bot.inventory
          .items()
          .find((item) => item.name === "torch");
        if (torch) {
          await placeBlock(
            "wall_torch",
            torchPosition.x,
            torchPosition.y,
            torchPosition.z,
            "side"
          );
          bot.chat(`Placed torch at ${torchPosition.toString()}`);
        }
      }
    }
  }

  bot.chat(`I've dug ${tunnelName}`);

  if (tunnelName !== "basementEntrance")
    saveMineLocation({
      name: tunnelName,
      direction,
      startsAt: startPosition,
      endsAt: startPosition.offset(depth * offsetX, -depth, depth * offsetZ),
      depth,
    });

  /* const cobblestoneCount = bot.inventory
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
  }

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
        await placeBlock(
          "cobblestone_stairs",
          stairPosition.x,
          stairPosition.y,
          stairPosition.z,
          "bottom"
        );
        bot.chat(`Placed cobblestone stair at ${stairPosition.toString()}`);
      }
    }
  } */

  return true;
}

/**
 * Builds a doorway at the specified position.
 * @param position The position to build the doorway at.
 * @param direction The direction the doorway should face.
 */
export async function digDoorway(position: Vec3, direction: string) {
  const offsetX = direction === "east" ? 1 : direction === "west" ? -1 : 0;
  const offsetZ = direction === "south" ? 1 : direction === "north" ? -1 : 0;

  // Clear the doorway space (2 blocks high)
  for (let y = 0; y < 2; y++) {
    const doorwayBlock = position.offset(offsetX, y, offsetZ);
    await breakBlockAt(doorwayBlock.x, doorwayBlock.y, doorwayBlock.z);

    // Ensure foundation under the floor blocks
    if (y === 0) {
      await ensureFoundation(doorwayBlock);
    }
  }

  // !important: Bot can't go thought doors yet
  // Place the door
  // await ensureDoor(); // Ensure the bot has a door
  // await placeBlock("wooden_door", position.x, position.y, position.z);
}

/**
 * Digs a straight tunnel in the specified direction.
 * @param direction The direction to dig the tunnel in.
 * @param length The length of the tunnel.
 * @param startPosition The starting position of the tunnel.
 */
export async function digStraightTunnel(
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

        // Ensure foundation under the floor blocks
        if (y === 0) {
          await ensureFoundation(blockPos);
        }
      }
    }
  }
}

/**
 * Digs a room at the specified position.
 * @param roomStart The starting position of the room.
 * @param roomSize The size of the room.
 */
export async function digRoom(
  roomStart: Vec3,
  roomSize: { width: number; height: number; length: number }
) {
  for (let z = 0; z < roomSize.length; z++) {
    for (let y = 0; y < roomSize.height; y++) {
      for (let x = -1; x < roomSize.width - 1; x++) {
        const roomBlock = roomStart.offset(x, y, z);
        await breakBlockAt(roomBlock.x, roomBlock.y, roomBlock.z);
        await __actionsDelay(1000);

        // Ensure foundation under the floor blocks
        if (y === 0) {
          await ensureFoundation(roomBlock);
        }
      }
    }
  }
}

/**
 * Ensures that the block below is solid. If it's air, place a foundation block.
 * @param position The current block position.
 * @param foundationBlock The block to place as foundation (e.g., dirt, plank).
 */
export async function ensureFoundation(position: Vec3): Promise<void> {
  const belowPosition = position.offset(0, -1, 0); // Position of the block below
  const dirtNum = getItemCount("dirt");
  const plankNum = getItemCount("planks");
  if (!dirtNum && !plankNum) {
    console.log("I don't have any dirt or planks to place!");
    await ensurePlanks(4);
    return;
  }

  const stubName = dirtNum ? "dirt" : "planks";

  // Check if the block below is air
  const blockBelow = bot.blockAt(belowPosition);
  if (blockBelow?.name === "air") {
    if (stubName) {
      // Place the foundation block below
      await placeBlock(
        stubName,
        belowPosition.x,
        belowPosition.y,
        belowPosition.z,
        "bottom"
      );
      console.log(`Placed ${stubName} at to fix a hole`);
    } else {
      console.log(`I don't have any ${stubName} to place!`);
    }
  }
}
