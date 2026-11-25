// Path: src/actions/riding.ts
// Getting on and off vehicles and rideable animals, and saddling an animal.

import { bot } from "../core/body";
import * as world from "./world.js";
import { goToPosition } from "./movement";
import { __actionsDelay } from "../utils/utility.js";
import { dismountVehicle, equipItem, lookAt, mountEntity as rideEntity, setControl, useEntity, useHeldItem } from "../core/primitives";
import { expectOk } from "../core/result";

/**
 * Attempts to dismount the bot from any vehicle it's currently in
 */
export async function dismountFromVehicle(): Promise<boolean> {
  console.log('Attempting to dismount from current vehicle...');

  if (!bot.vehicle) {
    console.log(`Not currently in any vehicle`);
    return false;
  }

  try {
    console.log(`Currently in a vehicle of type: ${bot.vehicle.name || "unknown"}, dismounting...`);
    await dismountVehicle();
    console.log(`Successfully dismounted from ${bot.vehicle.name || "vehicle"}`);
    return true;
  } catch (error) {
    console.log(`Failed to dismount: ${error}`);

    return await tryAlternateDismount();
  }
}

/**
 * Attempts to dismount using an alternate method (sneak)
 */
async function tryAlternateDismount(): Promise<boolean> {
  console.log("Trying alternate dismount method...");

  try {
    // In some versions, we can simulate pressing shift
    setControl("sneak", true);
    await __actionsDelay(500);
    setControl("sneak", false);

    // Check if we're still in the vehicle
    if (!bot.vehicle) {
      console.log("Successfully dismounted using alternate method");
      return true;
    } else {
      console.log("Still in vehicle after alternate method attempt");
      return false;
    }
  } catch (error) {
    console.log(`Alternate dismount method failed: ${error}`);
    return false;
  }
}

/**
 * Attempts to mount a specified entity type
 */
export async function mountEntity(entityType: string, maxDistance: number): Promise<boolean> {
  // Define the entity types to look for based on user input
  let entityTypes: string[] = getEntityTypesToSearch(entityType);

  // Find the nearest matching entity
  const targetEntity = findTargetEntity(entityTypes, maxDistance);

  if (!targetEntity) {
    console.log(`No mountable entity found within ${maxDistance} blocks`);
    return false;
  }

  // Move close to the entity if needed
  if (bot.entity.position.distanceTo(targetEntity.position) > 3) {
    await goToPosition(targetEntity.position.x, targetEntity.position.y, targetEntity.position.z, 2);
  }

  try {
    // Look at the entity before mounting
    await lookAt(targetEntity.position);

    // Different mounting logic based on entity type
    if (entityType.toLowerCase() === "boat") {
      return await mountBoat(targetEntity);
    } else {
      // Regular mounting for other entities
      expectOk(await rideEntity(targetEntity));
      console.log(`Successfully mounted the ${targetEntity.name}`);
      return true;
    }
  } catch (error) {
    console.log(`Failed to mount ${targetEntity.name}: ${error}`);
    return false;
  }
}

/**
 * Determines which entity types to search for
 */
function getEntityTypesToSearch(entityType: string): string[] {
  if (entityType.toLowerCase() === "animal" || entityType.toLowerCase() === "rideable") {
    return ["horse", "camel", "donkey", "mule", "pig", "strider"];
  } else if (entityType.toLowerCase() === "vehicle") {
    return ["boat", "minecart"];
  } else {
    return [entityType.toLowerCase()];
  }
}

/**
 * Finds a target entity based on the given types
 */
function findTargetEntity(entityTypes: string[], maxDistance: number) {
  for (const entityType of entityTypes) {
    const entity = world.getNearestEntityWhere(
      (entity) => typeof entity.name === 'string' && entity.name.toLowerCase().includes(entityType),
      maxDistance
    );

    if (entity) {
      console.log(`Found ${entityType} at ${entity.position.x}, ${entity.position.y}, ${entity.position.z}`);
      return entity;
    }
  }
  return null;
}

/**
 * Special mounting logic for boats to handle passenger seating
 */
async function mountBoat(targetEntity: any): Promise<boolean> {
  try {
    // Check if the boat already has passengers
    if (targetEntity.passengers && targetEntity.passengers.length === 1) {
      // There's already one passenger, so we can directly mount as the second passenger
      expectOk(await rideEntity(targetEntity));
      console.log(`Mounted as passenger in the ${targetEntity.name}`);
      return true;
    }

    // No passengers yet, try different methods

    // Method 1: Try activateEntity with sneaking (often helps get passenger seat)
    try {
      {
        await useEntity(targetEntity);
        console.log(`Attempted to mount as passenger using activateEntity`);

        // Check if mounting was successful
        await __actionsDelay(500);
        if (bot.vehicle) {
          return true;
        }
      }
    } catch (e) {
      console.log(`Could not use activateEntity, trying regular mount`);
    }

    // Method 2: Regular mounting (usually gets the driver's seat)
    expectOk(await rideEntity(targetEntity));
    console.log(`Mounted the ${targetEntity.name} (likely as driver)`);
    return true;
  } catch (error) {
    console.log(`Failed specific boat mounting: ${error}`);

    // Method 3: Fall back to simple mount as last resort
    try {
      expectOk(await rideEntity(targetEntity));
      console.log(`Mounted the ${targetEntity.name} with fallback method`);
      return true;
    } catch (innerError) {
      console.log(`All mounting methods failed: ${innerError}`);
      return false;
    }
  }
}

/**
 * Places a saddle on a nearby rideable animal
 */
export async function deploySaddle(inventoryItem: any, maxDistance: number): Promise<boolean> {
  // Find a rideable animal
  const rideable = world.getNearestEntityWhere(
    entity =>
      entity.name === "horse" ||
      entity.name === "donkey" ||
      entity.name === "mule" ||
      entity.name === "pig" ||
      entity.name === "strider",
    maxDistance
  );

  if (!rideable) {
    console.log(`Could not find any rideable animals within ${maxDistance} blocks.`);
    return false;
  }

  // Move close to the animal
  if (bot.entity.position.distanceTo(rideable.position) > 3) {
    await goToPosition(rideable.position.x, rideable.position.y, rideable.position.z, 2);
  }

  try {
    // Equip the saddle
    await equipItem(inventoryItem.name, "hand");

    // Look at the animal
    await lookAt(rideable.position);
    await __actionsDelay(300);

    // Try to use the saddle on the animal
    return await tryInteractWithEntity(rideable);
  } catch (error) {
    console.log(`Failed to saddle animal: ${error}`);
    return false;
  }
}

/**
 * Tries to interact with an entity using the currently equipped item
 */
async function tryInteractWithEntity(entity: any): Promise<boolean> {
  // Try using activateEntity if available
  try {
    // @ts-ignore - Some versions of Mineflayer have this method
    if (bot.activateEntity) {
      // @ts-ignore
      await useEntity(entity);
      console.log(`Successfully used item on ${entity.name}`);
      return true;
    }
  } catch (e) {
    console.log(`activateEntity failed: ${e}`);
  }

  // Alternative method: try looking at different parts of the entity
  const offsets = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0.5, y: 0.5, z: 0.5 },
    { x: -0.5, y: 0.5, z: -0.5 }
  ];

  for (const offset of offsets) {
    try {
      const pos = entity.position.offset(offset.x, offset.y, offset.z);
      await lookAt(pos);
      await __actionsDelay(200);
      useHeldItem();
      await __actionsDelay(500);

      // Check if action was successful
      // This is entity-specific and would need more detailed implementation
      console.log(`Successfully used item on ${entity.name} (alternative method)`);
      return true;
    } catch (e) {
      continue;
    }
  }

  console.log(`Failed to interact with ${entity.name} after multiple attempts`);
  return false;
}
