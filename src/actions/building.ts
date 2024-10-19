import { Vec3 } from "vec3";
import { bot } from "..";
import {
  breakBlockAt,
  pickupNearbyItems,
  placeBlock,
} from "./worldInteraction";
import {
  getBaseLocation,
  saveBasementLocation,
} from "../managers/persistenceManager";
import {
  digDiagonalTunnel,
  digDoorway,
  digRoom,
  type DirectionType,
} from "./digging";
import { gatherWood } from "./gatherWood";
import { ensurePickaxe, ensureShovel } from "./ensureTools";

// Helper function to place dirt if there's a hole
async function fillHole(pos: Vec3) {
  const dirt = bot.inventory.items().find((item) => item.name === "dirt");
  if (!dirt) {
    console.log("No dirt available to fill holes.");
    return;
  }

  const blockBelow = bot.blockAt(pos.offset(0, -1, 0));
  if (blockBelow && blockBelow.name === "air") {
    await placeBlock(
      dirt.name,
      blockBelow.position.x,
      blockBelow.position.y,
      blockBelow.position.z
    );

    console.log(`Filled hole at ${pos.toString()} with dirt.`);
  }
}

export async function clearSite(
  startPosition: Vec3,
  width: number = 6,
  length: number = 6,
  height: number = 4
) {
  // Clear and flatten the area
  for (let x = -Math.floor(width / 2); x <= Math.floor(width / 2); x++) {
    for (let z = -Math.floor(length / 2); z <= Math.floor(length / 2); z++) {
      for (let y = 0; y < height; y++) {
        const currentPos = startPosition.offset(x, y, z);
        const block = bot.blockAt(currentPos);

        if (block && block.name !== "air") {
          // Dig the block if it's not at ground level
          if (currentPos.y > startPosition.y) {
            await breakBlockAt(
              block.position.x,
              block.position.y,
              block.position.z
            );
            console.log(`Cleared block at ${currentPos.toString()}.`);
          }
        } else if (currentPos.y === startPosition.y) {
          // Fill the hole if it's at ground level
          await fillHole(currentPos);
        }
      }
    }
  }
}

/**
 * Build a shelter to survive the night.
 * @param roomSize The size of the room to build.
 * @param tunnelDepth The depth of the tunnel to dig.
 */
export async function buildShelter(
  roomSize: { width: number; height: number; length: number } = {
    width: 3,
    height: 3,
    length: 4,
  },
  tunnelDepth: number = 6
) {
  console.log(`Building a shelter to survive the night...`);

  const basementPosition = getBaseLocation();
  const startPosition = basementPosition
    ? new Vec3(
        Math.floor(basementPosition.x),
        Math.floor(basementPosition.y),
        Math.floor(basementPosition.z)
      ).offset(0, 0, 0)
    : bot.entity.position.clone();

  let direction = "south" as DirectionType;

  // Do not work as expected
  /* const yaw = bot.entity.yaw;

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

  await gatherWood(12);
  await ensurePickaxe(2); // Need at least 2 pickaxes to dig the tunnel and room
  await ensureShovel(); // Need a shovel to dig the dirt

  // Dig the diagonal tunnel
  await digDiagonalTunnel(
    direction,
    tunnelDepth,
    { width: 1, height: 4 },
    startPosition,
    "basementEntrance"
  );

  // Build a doorway at the entrance to basement (end of tunnel)
  const enterPosition = startPosition.offset(
    tunnelDepth * offsetX,
    -tunnelDepth,
    tunnelDepth * offsetZ
  );
  await digDoorway(enterPosition, direction);
  console.log("Enter doorway built!");

  // Adjust roomStart position to center the tunnel
  const roomStart = enterPosition.offset(offsetX * 2, 0, offsetZ * 2);

  // Create the room at the end of the tunnel
  await digRoom(roomStart, roomSize);
  console.log("Room dig complete!");

  // Make a doorway on another side of the room and dig a mine
  const exitPosition = enterPosition.offset(
    offsetX * roomSize.length + offsetX,
    0,
    offsetZ * roomSize.length + offsetZ
  );
  await digDoorway(exitPosition, direction);
  console.log("Exit doorway built!");

  saveBasementLocation(roomStart);

  await pickupNearbyItems(bot);
}

export async function buildShack() {}
export async function buildWoodenHouse() {}
export async function buildStoneHouse() {}

// TBD
export async function buildCastle() {}
export async function buildFortress() {}
export async function buildTower() {}
