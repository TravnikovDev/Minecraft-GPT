// Path: src/actions/vehicleDeploy.ts
// Putting a vehicle from the inventory into the world: a minecart on rails, a boat on water, a saddle on an animal.

import { Vec3 } from "vec3";
import type { Block } from "prismarine-block";
import { bot } from "../core/body";
import * as world from "./world.js";
import { goToPosition } from "./movement";
import { __actionsDelay } from "../utils/utility.js";
import { equipItem, lookAt, useBlock, useHeldItem } from "../core/primitives";
import { deploySaddle } from "./riding";

export async function deployVehicle(vehicleType: string, maxDistance: number = 16): Promise<boolean> {
  console.log(`Attempting to deploy ${vehicleType}...`);

  // Check if we have the vehicle/item in inventory
  const inventoryItem = findMatchingInventoryItem(vehicleType);

  if (!inventoryItem) {
    console.log(`You don't have a ${vehicleType} in your inventory.`);
    return false;
  }

  // Different deployment logic based on vehicle type
  if (vehicleType.toLowerCase() === "minecart" || vehicleType.toLowerCase().includes("cart")) {
    return await deployMinecart(inventoryItem, maxDistance);
  }
  else if (vehicleType.toLowerCase().includes("boat") || inventoryItem.name.includes("boat")) {
    return await deployBoat(inventoryItem, maxDistance);
  }
  else if (vehicleType.toLowerCase() === "saddle") {
    return await deploySaddle(inventoryItem, maxDistance);
  }

  console.log(`Unrecognized vehicle type: ${vehicleType}`);
  return false;
}

/**
 * Finds an item in the inventory matching the given type
 */
function findMatchingInventoryItem(itemType: string) {
  return bot.inventory.items().find(item =>
    item.name.toLowerCase() === itemType.toLowerCase() ||
    item.name.toLowerCase().includes(itemType.toLowerCase()) ||
    (itemType === "saddle" && item.name === "saddle")
  );
}

/**
 * Deploys a minecart on nearby rails
 */
async function deployMinecart(inventoryItem: any, maxDistance: number): Promise<boolean> {
  console.log(`Found ${inventoryItem.name} in inventory. Looking for rails to place it on...`);

  // Find a suitable rail block
  const { railPosition, railBlock } = await findNearestRail(maxDistance);

  if (!railPosition || !railBlock) {
    console.log(`Could not find rails within ${maxDistance} blocks to place the minecart.`);
    return false;
  }

  // Move to the standing position
  try {
    console.log(`Moving to position near rails...`);
    if (railBlock) {
      await goToPosition(railBlock.position.x, railBlock.position.y, railBlock.position.z);
      await __actionsDelay(500);

      // Equip the minecart
      console.log(`Equipping ${inventoryItem.name}...`);
      await equipItem(inventoryItem.name, "hand");
      await __actionsDelay(300);
    }
    // Try multiple methods to place the minecart
    return await tryPlaceMinecart(railPosition, railBlock);
  } catch (error) {
    console.log(`Failed to move to position near rails: ${error}`);
    return false;
  }
}

/**
 * Finds the nearest rail block
 */
async function findNearestRail(maxDistance: number): Promise<{ railPosition: Vec3 | null, railBlock: Block | null }> {
  // Search for all rail types
  const railTypes = ["rail", "powered_rail", "detector_rail", "activator_rail"];

  for (const railType of railTypes) {
    const foundRails = bot.findBlocks({
      matching: (block) => block !== null && block.name.includes(railType),
      maxDistance: maxDistance,
      count: 100
    });

    if (foundRails.length > 0) {
      // Sort by distance
      const sortedRails = foundRails
        .map(pos => ({ pos, distance: bot.entity.position.distanceTo(pos) }))
        .sort((a, b) => a.distance - b.distance);

      for (const rail of sortedRails) {
        const block = bot.blockAt(rail.pos);
        if (block) {
          console.log(`Found ${block.name} at ${rail.pos.x}, ${rail.pos.y}, ${rail.pos.z}`);
          return { railPosition: rail.pos, railBlock: block };
        }
      }
    }
  }

  return { railPosition: null, railBlock: null };
}

/**
 * Tries different methods to place a minecart on rails
 */
async function tryPlaceMinecart(railPosition: Vec3, railBlock: Block): Promise<boolean> {
  // Method 1: Look at center of rail and use activateBlock
  console.log(`Looking at rail at ${railPosition.x}, ${railPosition.y}, ${railPosition.z}...`);
  await lookAt(railPosition.offset(0.5, 0.5, 0.5));
  await __actionsDelay(500);

  try {
    // Output current bot position and where it's looking to help with debugging
    const currentPos = bot.entity.position;
    console.log(`Bot position: ${currentPos.x.toFixed(2)}, ${currentPos.y.toFixed(2)}, ${currentPos.z.toFixed(2)}`);
    console.log(`Bot yaw: ${bot.entity.yaw.toFixed(2)}, pitch: ${bot.entity.pitch.toFixed(2)}`);

    console.log(`Activating rail block...`);
    await useBlock(railBlock);
    await __actionsDelay(1000);

    // Check if the minecart was placed
    if (await checkEntityPlaced("minecart", 3)) {
      console.log(`Successfully placed minecart on rails!`);
      return true;
    }

    // Method 2: Try using placeBlock instead
    console.log(`Method 1 failed, trying alternative placement method...`);
    const referenceBlock = bot.blockAt(railPosition.offset(0, -1, 0)); // Block below rail

    if (referenceBlock && referenceBlock.diggable) {
      // Look directly at the top face of the block below the rail
      await lookAt(referenceBlock.position.offset(0.5, 1, 0.5));
      await __actionsDelay(300);

      try {
        // Try to use the minecart on the top face of the block below
        await useBlock(referenceBlock); // the minecart onto the rail
        await __actionsDelay(1000);

        // Check again if minecart was placed
        if (await checkEntityPlaced("minecart", 3)) {
          console.log(`Successfully placed minecart using method 2!`);
          return true;
        }
      } catch (e) {
        console.log(`Method 2 failed: ${e}`);
      }
    }

    // Method 3: Try to use activateItem while looking at rail
    console.log(`Trying method 3: activateItem...`);
    await lookAt(railPosition.offset(0.5, 0.6, 0.5));
    await __actionsDelay(300);

    try {
      useHeldItem();
      await __actionsDelay(1000);

      // Check again if minecart was placed
      if (await checkEntityPlaced("minecart", 3)) {
        console.log(`Successfully placed minecart using method 3!`);
        return true;
      }

      console.log(`All methods failed. Could not place minecart on rail.`);
      return false;
    } catch (e) {
      console.log(`Method 3 failed: ${e}`);
      return false;
    }
  } catch (error) {
    console.log(`Failed to place minecart: ${error}`);
    return false;
  }
}

/**
 * Deploys a boat on nearby water
 */
async function deployBoat(inventoryItem: any, maxDistance: number): Promise<boolean> {
  console.log(`Found ${inventoryItem.name} in inventory. Looking for water to place it on...`);

  try {
    // Find suitable water locations
    const suitableWaterBlocks = await findWaterBlocksWithAirAbove(maxDistance);

    if (suitableWaterBlocks.length === 0) {
      console.log(`Could not find suitable water within ${maxDistance} blocks to place the boat.`);
      return false;
    }

    console.log(`Found ${suitableWaterBlocks.length} suitable water blocks with air above.`);

    // Try each suitable water block until successful
    for (const waterData of suitableWaterBlocks) {
      if (await tryPlaceBoatAtWaterLocation(inventoryItem, waterData.pos, waterData.distance)) {
        return true;
      }
    }

    console.log(`Tried ${suitableWaterBlocks.length} water blocks but failed to place the boat.`);
    return false;
  } catch (error) {
    console.log(`Error while deploying boat: ${error}`);
    return false;
  }
}

/**
 * Finds water blocks with air above them
 */
async function findWaterBlocksWithAirAbove(maxDistance: number): Promise<{ pos: Vec3, distance: number }[]> {
  // First find water blocks without checking air above in the matcher
  const waterBlocks = bot.findBlocks({
    matching: (block) => block !== null && block.name === "water",
    maxDistance: maxDistance,
    count: 50
  });

  if (waterBlocks.length === 0) {
    return [];
  }

  // Sort water blocks by distance
  const sortedWaterPositions = waterBlocks
    .map(pos => ({ pos, distance: bot.entity.position.distanceTo(pos) }))
    .sort((a, b) => a.distance - b.distance);

  // Now check if there's air above each water block
  const suitableWaterBlocks = [];

  for (const waterData of sortedWaterPositions) {
    const waterPos = waterData.pos;
    const waterBlock = bot.blockAt(waterPos);

    if (!waterBlock) continue;

    // Check if there's air above this water block
    const abovePos = waterPos.clone();
    abovePos.y += 1;
    const blockAbove = bot.blockAt(abovePos);

    if (blockAbove && blockAbove.name === "air") {
      suitableWaterBlocks.push({
        pos: waterPos,
        distance: waterData.distance
      });
    }
  }

  return suitableWaterBlocks;
}

/**
 * Tries to place a boat at a specific water location
 */
async function tryPlaceBoatAtWaterLocation(inventoryItem: any, waterPos: Vec3, distance: number): Promise<boolean> {
  const waterBlock = bot.blockAt(waterPos);

  if (!waterBlock) return false;

  console.log(`Trying to place boat at water: ${waterPos.x}, ${waterPos.y}, ${waterPos.z} (distance: ${distance.toFixed(1)})`);

  // If we're already close enough, no need to move
  if (distance > 3) {
    try {
      // Move close to the water block if needed
      await goToPosition(waterPos.x, waterPos.y, waterPos.z, 3);
    } catch (error) {
      console.log(`Failed to move to water at ${waterPos.x}, ${waterPos.y}, ${waterPos.z}: ${error}`);
      return false;
    }
  }

  try {
    // Equip the boat
    await equipItem(inventoryItem.name, "hand");
    await __actionsDelay(300);

    // Look at the water surface
    const waterSurfacePos = new Vec3(waterPos.x + 0.5, waterPos.y + 0.5, waterPos.z + 0.5);
    await lookAt(waterSurfacePos);
    await __actionsDelay(500);

    console.log(`Looking at water at ${waterSurfacePos.x}, ${waterSurfacePos.y}, ${waterSurfacePos.z}`);
    console.log(`Bot position: ${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)}`);
    console.log(`Bot yaw: ${bot.entity.yaw.toFixed(2)}, pitch: ${bot.entity.pitch.toFixed(2)}`);

    // Method 1: Try to place the boat using activateItem
    useHeldItem();
    await __actionsDelay(1000);

    // Check if boat was placed
    if (await checkEntityPlaced("boat", 8)) {
      console.log(`Successfully deployed boat in water at ${waterPos.x}, ${waterPos.y}, ${waterPos.z}`);
      return true;
    }

    // Method 2: Try activating the water block directly
    try {
      await useBlock(waterBlock);
      await __actionsDelay(1000);

      // Check again
      if (await checkEntityPlaced("boat", 8)) {
        console.log(`Successfully deployed boat (method 2) at ${waterPos.x}, ${waterPos.y}, ${waterPos.z}`);
        return true;
      }
    } catch (e) {
      console.log(`Failed to activate water block: ${e}`);
    }

    return false;
  } catch (error) {
    console.log(`Failed to place boat at ${waterPos.x}, ${waterPos.y}, ${waterPos.z}: ${error}`);
    return false;
  }
}

/**
 * Checks if an entity of given type was placed nearby
 */
async function checkEntityPlaced(entityType: string, distance: number): Promise<boolean> {
  const nearbyEntity = world.getNearestEntityWhere(
    entity => entity && typeof entity.name === 'string' && entity.name.toLowerCase().includes(entityType),
    distance
  );

  return nearbyEntity !== null;
}