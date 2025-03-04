// src/actions/worldInteraction.ts

import { bot } from "../index";
import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { Block } from "prismarine-block";
import * as gameData from "../utils/minecraftData";
import * as world from "./world.js";
import { goToPosition } from "./movement";
import type { Bot } from "mineflayer";
import { __actionsDelay } from "../utils/utility.js";

// Move functions like placeBlock, breakBlockAt, collectBlock, etc.

export async function placeBlock(
  blockType: string,
  x: number,
  y: number,
  z: number,
  placeOn: string = "bottom"
): Promise<boolean> {
  // if (!gameData.getBlockId(blockType)) {
  //   console.log(`Invalid block type: ${blockType}.`);
  //   return false;
  // }

  const targetDest = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));

  let block = bot.inventory
    .items()
    .find((item) => item.name.includes(blockType));
  if (!block && bot.game.gameMode === "creative") {
    // TODO: Rework
    await bot.creative.setInventorySlot(36, gameData.makeItem(blockType, 1)); // 36 is first hotbar slot
    block = bot.inventory.items().find((item) => item.name.includes(blockType));
  }
  if (!block) {
    console.log(`Don't have any ${blockType} to place.`);
    return false;
  }

  const targetBlock = bot.blockAt(targetDest);
  if (!targetBlock) {
    console.log(`No block found at ${targetDest}.`);
    return false;
  }

  if (targetBlock.name === blockType) {
    console.log(`${blockType} already at ${targetBlock.position}.`);
    return false;
  }

  const emptyBlocks = [
    "air",
    "water",
    "lava",
    "grass",
    "tall_grass",
    "snow",
    "dead_bush",
    "fern",
  ];
  if (!emptyBlocks.includes(targetBlock.name)) {
    console.log(
      `${targetBlock.name} is in the way at ${targetBlock.position}.`
    );
    const removed = await breakBlockAt(x, y, z);
    if (!removed) {
      console.log(
        `Cannot place ${blockType} at ${targetBlock.position}: block in the way.`
      );
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 200)); // Wait for block to break
  }

  // Determine the build-off block and face vector
  const dirMap: { [key: string]: Vec3 } = {
    top: new Vec3(0, 1, 0),
    bottom: new Vec3(0, -1, 0),
    north: new Vec3(0, 0, -1),
    south: new Vec3(0, 0, 1),
    east: new Vec3(1, 0, 0),
    west: new Vec3(-1, 0, 0),
  };

  let dirs: Vec3[] = [];
  if (placeOn === "side") {
    dirs.push(dirMap["north"], dirMap["south"], dirMap["east"], dirMap["west"]);
  } else if (dirMap[placeOn]) {
    dirs.push(dirMap[placeOn]);
  } else {
    dirs.push(dirMap["bottom"]);
    console.log(`Unknown placeOn value "${placeOn}". Defaulting to bottom.`);
  }

  // Add remaining directions
  dirs.push(...Object.values(dirMap).filter((d) => !dirs.includes(d)));

  let buildOffBlock: Block | null = null;
  let faceVec: Vec3 | null = null;

  for (const d of dirs) {
    const adjacentBlock = bot.blockAt(targetDest.plus(d));
    if (adjacentBlock && !emptyBlocks.includes(adjacentBlock.name)) {
      buildOffBlock = adjacentBlock;
      faceVec = d.scaled(-1); // Invert direction
      break;
    }
  }

  if (!buildOffBlock || !faceVec) {
    console.log(
      `Cannot place ${blockType} at ${targetBlock.position}: nothing to place on.`
    );
    return false;
  }

  // Move away if too close
  const pos = bot.entity.position;
  const posAbove = pos.offset(0, 1, 0);
  const dontMoveFor = [
    "torch",
    "redstone_torch",
    "redstone",
    "lever",
    "button",
    "rail",
    "detector_rail",
    "powered_rail",
    "activator_rail",
    "tripwire_hook",
    "tripwire",
    "water_bucket",
  ];
  if (
    !dontMoveFor.includes(blockType) &&
    (pos.distanceTo(targetBlock.position) < 1 ||
      posAbove.distanceTo(targetBlock.position) < 1)
  ) {
    const goal = new pf.goals.GoalInvert(
      new pf.goals.GoalNear(
        targetBlock.position.x,
        targetBlock.position.y,
        targetBlock.position.z,
        2
      )
    );
    // bot.pathfinder.setMovements(new pf.Movements(bot));
    await bot.pathfinder.goto(goal);
  }

  // Move closer if too far
  if (bot.entity.position.distanceTo(targetBlock.position) > 4.5) {
    await goToPosition(
      targetBlock.position.x,
      targetBlock.position.y,
      targetBlock.position.z,
      4
    );
  }

  await bot.equip(block, "hand");
  await bot.lookAt(buildOffBlock.position);
  await __actionsDelay(500);

  try {
    await bot.placeBlock(buildOffBlock, faceVec);
    console.log(`Placed ${blockType} at ${targetDest}.`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return true;
  } catch (err) {
    if (err instanceof Error) {
      console.log(
        `Failed to place ${blockType} at ${targetDest}: ${err.message}`
      );
    } else {
      console.log(
        `Failed to place ${blockType} at ${targetDest}: ${String(err)}`
      );
    }
    return false;
  }
}

export async function breakBlockAt(
  x: number,
  y: number,
  z: number
): Promise<boolean> {
  if (x == null || y == null || z == null) {
    throw new Error("Invalid position to break block at.");
  }
  const blockPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
  const block = bot.blockAt(blockPos);
  if (!block) {
    console.log(`No block found at position ${blockPos}.`);
    return false;
  }
  if (block.name !== "air" && block.name !== "water" && block.name !== "lava") {
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
      await goToPosition(x, y, z);
    }
    if (bot.game.gameMode !== "creative") {
      await bot.tool.equipForBlock(block);
      const itemId = bot.heldItem ? bot.heldItem.type : null;
      if (!block.canHarvest(itemId)) {
        console.log(`Don't have right tools to break ${block.name}.`);
        return false;
      }
    }
    if (!bot.canDigBlock(block)) {
      console.log(`Cannot break ${block.name} at ${blockPos}.`);
      return false;
    }
    await bot.lookAt(block.position, true); // Ensure the bot has finished turning
    await __actionsDelay(500);
    try {
      await bot.dig(block, true);
      console.log(
        `Broke ${block.name} at x:${x.toFixed(1)}, y:${y.toFixed(
          1
        )}, z:${z.toFixed(1)}.`
      );
      return true;
    } catch (err) {
      console.error(`Failed to dig the block: ${err}`);
      return false;
    }
  } else {
    console.log(
      `Skipping block at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(
        1
      )} because it is ${block.name}.`
    );
    return false;
  }
}

export async function activateNearestBlock(type: string) {
  /**
   * Activate the nearest block of the given type.
   * @param {string} type, the type of block to activate.
   * @returns {Promise<boolean>} true if the block was activated, false otherwise.
   * @example
   * await skills.activateNearestBlock( "lever");
   * **/
  let block = world.getNearestBlock(type, 16);
  if (!block) {
    console.log(`Could not find any ${type} to activate.`);
    return false;
  }
  if (bot.entity.position.distanceTo(block.position) > 4.5) {
    let pos = block.position;
    // bot.pathfinder.setMovements(new pf.Movements(bot));
    await bot.pathfinder.goto(new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
  }
  await bot.activateBlock(block);
  console.log(
    `Activated ${type} at x:${block.position.x.toFixed(
      1
    )}, y:${block.position.y.toFixed(1)}, z:${block.position.z.toFixed(1)}.`
  );
  return true;
}

export async function tillAndSow(
  x: number,
  y: number,
  z: number,
  seedType: string | null = null
): Promise<boolean> {
  x = Math.round(x);
  y = Math.round(y);
  z = Math.round(z);
  const blockPos = new Vec3(x, y, z);
  const block = bot.blockAt(blockPos);
  if (!block) {
    console.log(`No block found at ${blockPos}.`);
    return false;
  }
  if (
    block.name !== "grass_block" &&
    block.name !== "dirt" &&
    block.name !== "farmland"
  ) {
    console.log(`Cannot till ${block.name}, must be grass_block or dirt.`);
    return false;
  }
  const above = bot.blockAt(blockPos.offset(0, 1, 0));
  if (above && above.name !== "air") {
    console.log(`Cannot till, there is ${above.name} above the block.`);
    return false;
  }
  // Move closer if too far
  if (bot.entity.position.distanceTo(block.position) > 4.5) {
    await goToPosition(x, y, z, 4);
  }
  if (block.name !== "farmland") {
    const hoe = bot.inventory.items().find((item) => item.name.includes("hoe"));
    if (!hoe) {
      console.log(`Cannot till, no hoes.`);
      return false;
    }
    await bot.equip(hoe, "hand");
    await bot.activateBlock(block);
    console.log(
      `Tilled block x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`
    );
  }

  if (seedType) {
    if (seedType.endsWith("seed") && !seedType.endsWith("seeds"))
      seedType += "s"; // Fixes common mistake
    const seeds = bot.inventory
      .items()
      .find((item) => item.name.includes(seedType || "seed"));
    if (!seeds) {
      console.log(`No ${seedType} to plant.`);
      return false;
    }
    await bot.equip(seeds, "hand");
    await bot.placeBlock(block, new Vec3(0, -1, 0));
    console.log(
      `Planted ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(
        1
      )}, z:${z.toFixed(1)}.`
    );
  }
  return true;
}

export async function pickupNearbyItems(
  bot: Bot,
  distance = 8
): Promise<boolean> {
  const getNearestItem = (bot: Bot) =>
    bot.nearestEntity(
      (entity) =>
        entity.name == "item" &&
        entity.onGround &&
        bot.entity.position.distanceTo(entity.position) < distance
    );
  let nearestItem = getNearestItem(bot);

  let pickedUp = 0;
  while (nearestItem) {
    // bot.pathfinder.setMovements(new pf.Movements(bot));
    await bot.pathfinder.goto(
      new pf.goals.GoalFollow(nearestItem, 0.8),
      () => {}
    );
    await __actionsDelay(500);
    const prev = nearestItem;
    nearestItem = getNearestItem(bot);
    if (prev === nearestItem) {
      break;
    }
    pickedUp++;
  }
  console.log(`Picked up ${pickedUp} items.`);
  return true;
}

export async function useNearbyObject(objectType: string, maxDistance: number = 16, action: string = "use"): Promise<boolean> {
  console.log(`Looking to ${action} ${objectType}...`);
  
  // Check if this is a dismount command for any mountable entity
  if ((action === "exit" || action === "leave" || action === "dismount" || action === "get out")) {
    // Simplified dismount logic - don't check object type when dismounting
    // Just check if the bot is in any vehicle and dismount
    console.log('Attempting to dismount from current vehicle...');
    
    if (bot.vehicle) {
      try {
        console.log(`Currently in a vehicle of type: ${bot.vehicle.name || "unknown"}, dismounting...`);
        await bot.dismount();
        console.log(`Successfully dismounted from ${bot.vehicle.name || "vehicle"}`);
        return true;
      } catch (error) {
        console.log(`Failed to dismount: ${error}`);
        
        // Try alternate dismount method
        try {
          console.log("Trying alternate dismount method...");
          // In some versions, we can simulate pressing shift
          bot.setControlState('sneak', true);
          await __actionsDelay(500);
          bot.setControlState('sneak', false);
          
          // Check if we're still in the vehicle
          if (!bot.vehicle) {
            console.log("Successfully dismounted using alternate method");
            return true;
          } else {
            console.log("Still in vehicle after alternate method attempt");
            return false;
          }
        } catch (innerError) {
          console.log(`Alternate dismount method failed: ${innerError}`);
          return false;
        }
      }
    } else {
      console.log(`Not currently in any vehicle`);
      return false;
    }
  }
  
  // Handle mountable entities (vehicles and animals)
  const mountableEntities = [
    "boat", "minecart",  // Vehicles
    "horse", "camel", "donkey", "mule", "pig", "strider"  // Rideable animals
  ];
  
  if (mountableEntities.includes(objectType.toLowerCase()) || 
      objectType.toLowerCase() === "animal" || 
      objectType.toLowerCase() === "rideable" ||
      objectType.toLowerCase() === "vehicle") {
    
    // Define the entity types to look for based on user input
    let entityTypes: string[] = [];
    
    if (objectType.toLowerCase() === "animal" || objectType.toLowerCase() === "rideable") {
      entityTypes = ["horse", "camel", "donkey", "mule", "pig", "strider"];
    } else if (objectType.toLowerCase() === "vehicle") {
      entityTypes = ["boat", "minecart"];
    } else {
      entityTypes = [objectType.toLowerCase()];
    }
    
    // Find the nearest matching entity
    let targetEntity = null;
    for (const entityType of entityTypes) {
      const entity = world.getNearestEntityWhere(
        (entity) => entity.name?.toLowerCase().includes(entityType),
        maxDistance
      );
      
      if (entity) {
        targetEntity = entity;
        console.log(`Found ${entityType} at ${entity.position.x}, ${entity.position.y}, ${entity.position.z}`);
        break;
      }
    }
    
    if (targetEntity) {
      // Move close to the entity if needed
      if (bot.entity.position.distanceTo(targetEntity.position) > 3) {
        await goToPosition(targetEntity.position.x, targetEntity.position.y, targetEntity.position.z, 2);
      }
      
      try {
        // Try to mount the entity as passenger if possible
        await bot.lookAt(targetEntity.position);
        
        // Check if the entity has multiple seats (like boats)
        let mountedAsPassenger = false;
        
        // Check if it's a vehicle that typically has multiple seats
        if (objectType.toLowerCase() === "boat") {
          try {
            // Check if there's already someone in the driver's seat
            if (targetEntity.passengers && targetEntity.passengers.length === 1) {
              // There's already one passenger, so we can directly mount as the second passenger
              await bot.mount(targetEntity);
              console.log(`Mounted as passenger in the ${targetEntity.name}`);
              mountedAsPassenger = true;
            } else if (!targetEntity.passengers || targetEntity.passengers.length === 0) {
              // No passengers yet, we need to find a way to mount as passenger
              // For boats, we can try right-clicking with a specific offset that might target the passenger seat
              
              // First, try to use the activateEntity method if available
              try {
                // @ts-ignore - Some Mineflayer versions have this method
                if (bot.activateEntity) {
                  // @ts-ignore
                  await bot.activateEntity(targetEntity, true); // true = sneaking which sometimes helps get passenger seat
                  console.log(`Attempted to mount as passenger using activateEntity`);
                  mountedAsPassenger = true;
                }
              } catch (e) {
                // If activateEntity failed or doesn't exist, fall back to regular mounting
                console.log(`Could not use activateEntity, falling back to regular mount`);
              }
              
              if (!mountedAsPassenger) {
                // Regular mounting - will likely get the driver's seat
                await bot.mount(targetEntity);
                console.log(`Mounted the ${targetEntity.name} (likely as driver)`);
              }
            }
          } catch (innerError) {
            console.log(`Failed specific passenger seat mounting: ${innerError}`);
            // Fall back to regular mounting if specific passenger mounting fails
            if (!mountedAsPassenger) {
              await bot.mount(targetEntity);
              console.log(`Mounted the ${targetEntity.name} with fallback method`);
            }
          }
        } else {
          // Regular mounting for other entities
          await bot.mount(targetEntity);
          console.log(`Successfully mounted the ${targetEntity.name}`);
        }
        return true;
      } catch (error) {
        console.log(`Failed to mount ${targetEntity.name}: ${error}`);
        return false;
      }
    } else {
      console.log(`No mountable entity found within ${maxDistance} blocks`);
      return false;
    }
  }
  
  // Handle interactive blocks with the existing activateNearestBlock function
  // Map common terms to their block names in Minecraft
  const blockTypeMap: Record<string, string> = {
    // ...existing block mappings...
    "button": "button",
    "wooden_button": "wooden_button",
    "stone_button": "stone_button",
    "lever": "lever",
    "leveler": "lever",
    "switch": "lever",
    "door": "door",
    "trapdoor": "trapdoor",
    "crafting_table": "crafting_table",
    "workbench": "crafting_table",
    "furnace": "furnace",
    "chest": "chest",
    "ender_chest": "ender_chest",
    "anvil": "anvil",
    "enchanting_table": "enchanting_table",
    "brewing_stand": "brewing_stand",
    "bed": "bed"
  };
  
  // Determine the actual block type to look for
  const blockType = blockTypeMap[objectType.toLowerCase()] || objectType;
  
  // Use the existing activateNearestBlock function
  return await activateNearestBlock(blockType);
}

export async function deployVehicle(vehicleType: string, maxDistance: number = 16): Promise<boolean> {
  console.log(`Attempting to deploy ${vehicleType}...`);
  
  // Check if we have the vehicle/item in inventory
  const inventoryItem = bot.inventory.items().find(item => 
    item.name.toLowerCase() === vehicleType.toLowerCase() || 
    item.name.toLowerCase().includes(vehicleType.toLowerCase()) || 
    (vehicleType === "saddle" && item.name === "saddle")
  );
  
  if (!inventoryItem) {
    console.log(`You don't have a ${vehicleType} in your inventory.`);
    return false;
  }
  
  // Different deployment logic based on vehicle type
  if (vehicleType.toLowerCase() === "minecart" || vehicleType.toLowerCase().includes("cart")) {
    // Enhanced minecart placement logic
    console.log(`Found ${inventoryItem.name} in inventory. Looking for rails to place it on...`);
    
    // Search for all rail types
    const railTypes = ["rail", "powered_rail", "detector_rail", "activator_rail"];
    let rails = null;
    let railBlock = null;
    
    // Find the nearest rail by checking each rail type
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
            rails = rail.pos;
            railBlock = block;
            console.log(`Found ${block.name} at ${rails.x}, ${rails.y}, ${rails.z}`);
            break;
          }
        }
        
        if (rails) break;
      }
    }
    
    if (!rails || !railBlock) {
      console.log(`Could not find rails within ${maxDistance} blocks to place the minecart.`);
      return false;
    }
    
    // Find the best position to stand to place the minecart
    // We want to be beside the rail, not on it
    const adjacentPositions = [
      {x: 1, y: 0, z: 0},
      {x: -1, y: 0, z: 0},
      {x: 0, y: 0, z: 1},
      {x: 0, y: 0, z: -1}
    ];
    
    let standingPos = null;
    
    for (const offset of adjacentPositions) {
      const possiblePos = rails.offset(offset.x, offset.y, offset.z);
      const blockAtPos = bot.blockAt(possiblePos);
      const blockBelowPos = bot.blockAt(possiblePos.offset(0, -1, 0));
      
      // Check if this is a valid standing position (solid block below, air at feet and head)
      if (blockAtPos && blockAtPos.name === "air" && blockBelowPos && blockBelowPos.solid) {
        standingPos = possiblePos;
        console.log(`Found good standing position at ${standingPos.x}, ${standingPos.y}, ${standingPos.z}`);
        break;
      }
    }
    
    // If we couldn't find a good adjacent position, try to stand on the rail itself as a last resort
    if (!standingPos) {
      // For rails, sometimes we need to stand directly on them
      standingPos = rails.offset(0, 1, 0); // Position above the rail
      console.log(`No good adjacent position found, will try to place from above rail at ${standingPos.x}, ${standingPos.y}, ${standingPos.z}`);
    }
    
    // Move to the standing position
    try {
      console.log(`Moving to position near rails...`);
      await goToPosition(standingPos.x, standingPos.y, standingPos.z, 0);
      await __actionsDelay(500);
      
      // Equip the minecart
      console.log(`Equipping ${inventoryItem.name}...`);
      await bot.equip(inventoryItem, "hand");
      await __actionsDelay(300);
      
      // Use multiple methods to place the minecart
      
      // Method 1: Look at center of rail and use activateBlock
      console.log(`Looking at rail at ${rails.x}, ${rails.y}, ${rails.z}...`);
      await bot.lookAt(rails.offset(0.5, 0.5, 0.5), true);
      await __actionsDelay(500);
      
      try {
        // Output current bot position and where it's looking to help with debugging
        const currentPos = bot.entity.position;
        console.log(`Bot position: ${currentPos.x.toFixed(2)}, ${currentPos.y.toFixed(2)}, ${currentPos.z.toFixed(2)}`);
        console.log(`Bot yaw: ${bot.entity.yaw.toFixed(2)}, pitch: ${bot.entity.pitch.toFixed(2)}`);
        
        console.log(`Activating rail block...`);
        await bot.activateBlock(railBlock);
        await __actionsDelay(1000);
        
        // Check if the minecart was placed by looking for a minecart entity nearby
        const nearbyMinecart = world.getNearestEntityWhere(
          entity => entity.name?.toLowerCase().includes("minecart"),
          3
        );
        
        if (nearbyMinecart) {
          console.log(`Successfully placed minecart on rails!`);
          return true;
        }
        
        // Method 2: Try using placeBlock instead
        console.log(`Method 1 failed, trying alternative placement method...`);
        const referenceBlock = bot.blockAt(rails.offset(0, -1, 0)); // Block below rail
        
        if (referenceBlock && referenceBlock.solid) {
          // Look directly at the top face of the block below the rail
          await bot.lookAt(referenceBlock.position.offset(0.5, 1, 0.5), true);
          await __actionsDelay(300);
          
          try {
            // Try to use the minecart on the top face of the block below
            await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
            await __actionsDelay(1000);
            
            // Check again if minecart was placed
            const minecartAfterMethod2 = world.getNearestEntityWhere(
              entity => entity.name?.toLowerCase().includes("minecart"),
              3
            );
            
            if (minecartAfterMethod2) {
              console.log(`Successfully placed minecart using method 2!`);
              return true;
            }
          } catch (e) {
            console.log(`Method 2 failed: ${e}`);
          }
        }
        
        // Method 3: Try to use activateItem while looking at rail
        console.log(`Trying method 3: activateItem...`);
        await bot.lookAt(rails.offset(0.5, 0.6, 0.5), true);
        await __actionsDelay(300);
        
        try {
          await bot.activateItem();
          await __actionsDelay(1000);
          
          // Check again if minecart was placed
          const minecartAfterMethod3 = world.getNearestEntityWhere(
            entity => entity.name?.toLowerCase().includes("minecart"),
            3
          );
          
          if (minecartAfterMethod3) {
            console.log(`Successfully placed minecart using method 3!`);
            return true;
          } else {
            console.log(`All methods failed. Could not place minecart on rail.`);
            return false;
          }
        } catch (e) {
          console.log(`Method 3 failed: ${e}`);
          return false;
        }
      } catch (error) {
        console.log(`Failed to place minecart: ${error}`);
        return false;
      }
    } catch (error) {
      console.log(`Failed to move to position near rails: ${error}`);
      return false;
    }
  }
  else if (vehicleType.toLowerCase().includes("boat") || inventoryItem.name.includes("boat")) {
    // Fixed boat placement logic
    console.log(`Found ${inventoryItem.name} in inventory. Looking for water to place it on...`);
    
    // Use a simpler approach to find water blocks
    try {
      // First find water blocks without checking air above in the matcher
      const waterBlocks = bot.findBlocks({
        matching: (block) => block !== null && block.name === "water",
        maxDistance: maxDistance,
        count: 50
      });
      
      if (waterBlocks.length === 0) {
        console.log(`Could not find any water within ${maxDistance} blocks to place the boat.`);
        return false;
      }
      
      // Sort water blocks by distance
      const sortedWaterPositions = waterBlocks
        .map(pos => ({ pos, distance: bot.entity.position.distanceTo(pos) }))
        .sort((a, b) => a.distance - b.distance);
      
      console.log(`Found ${sortedWaterPositions.length} water blocks. Checking for suitable placement...`);
      
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
      
      if (suitableWaterBlocks.length === 0) {
        console.log(`Could not find any water with air above within ${maxDistance} blocks.`);
        return false;
      }
      
      console.log(`Found ${suitableWaterBlocks.length} suitable water blocks with air above.`);
      
      // Try each suitable water block until successful
      for (const waterData of suitableWaterBlocks) {
        const waterPos = waterData.pos;
        const waterBlock = bot.blockAt(waterPos);
        
        if (!waterBlock) continue;
        
        console.log(`Trying to place boat at water: ${waterPos.x}, ${waterPos.y}, ${waterPos.z} (distance: ${waterData.distance.toFixed(1)})`);
        
        // If we're already close enough, no need to move
        if (waterData.distance > 3) {
          try {
            // Move close to the water block if needed
            await goToPosition(waterPos.x, waterPos.y, waterPos.z, 3);
          } catch (error) {
            console.log(`Failed to move to water at ${waterPos.x}, ${waterPos.y}, ${waterPos.z}: ${error}`);
            continue;
          }
        }
        
        try {
          // Equip the boat
          await bot.equip(inventoryItem, "hand");
          await __actionsDelay(300);
          
          // Look at the water surface
          const waterSurfacePos = new Vec3(waterPos.x + 0.5, waterPos.y + 0.5, waterPos.z + 0.5);
          await bot.lookAt(waterSurfacePos, true);
          await __actionsDelay(500);
          
          console.log(`Looking at water at ${waterSurfacePos.x}, ${waterSurfacePos.y}, ${waterSurfacePos.z}`);
          console.log(`Bot position: ${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)}`);
          console.log(`Bot yaw: ${bot.entity.yaw.toFixed(2)}, pitch: ${bot.entity.pitch.toFixed(2)}`);
          
          // Try to place the boat using activateItem
          await bot.activateItem();
          await __actionsDelay(1000);
          
          // Check if boat was placed
          const nearbyBoat = world.getNearestEntityWhere(
            entity => entity && entity.name && entity.name.toLowerCase().includes("boat"),
            8
          );
          
          if (nearbyBoat) {
            console.log(`Successfully deployed boat in water at ${waterPos.x}, ${waterPos.y}, ${waterPos.z}`);
            return true;
          }
          
          // If the first attempt failed, try activating the water block directly
          try {
            await bot.activateBlock(waterBlock);
            await __actionsDelay(1000);
            
            // Check again
            const nearbyBoat2 = world.getNearestEntityWhere(
              entity => entity && entity.name && entity.name.toLowerCase().includes("boat"),
              8
            );
            
            if (nearbyBoat2) {
              console.log(`Successfully deployed boat (method 2) at ${waterPos.x}, ${waterPos.y}, ${waterPos.z}`);
              return true;
            }
          } catch (e) {
            console.log(`Failed to activate water block: ${e}`);
          }
          
        } catch (error) {
          console.log(`Failed to place boat at ${waterPos.x}, ${waterPos.y}, ${waterPos.z}: ${error}`);
          // Continue trying other water blocks
        }
      }
      
      console.log(`Tried ${suitableWaterBlocks.length} water blocks but failed to place the boat.`);
      return false;
    } catch (error) {
      console.log(`Error while looking for water blocks: ${error}`);
      return false;
    }
  }
  else if (vehicleType.toLowerCase() === "saddle") {
    // For saddles, find horses or other rideable mobs
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
      await bot.equip(inventoryItem, "hand");
      
      // Look at the animal
      await bot.lookAt(rideable.position);
      await __actionsDelay(300);
      
      // Use the saddle on the animal
      // @ts-ignore - Some versions of Mineflayer have this method
      if (bot.activateEntity) {
        // @ts-ignore
        await bot.activateEntity(rideable);
      } else {
        // Alternative method
        const offsets = [
          {x: 0, y: 0, z: 0},
          {x: 0, y: 1, z: 0}
        ];
        
        for (const offset of offsets) {
          try {
            const pos = rideable.position.offset(offset.x, offset.y, offset.z);
            await bot.lookAt(pos);
            // Using activateItem as a fallback
            await bot.activateItem();
            await __actionsDelay(500);
          } catch (e) {
            continue;
          }
        }
      }
      
      console.log(`Successfully saddled the ${rideable.name} at ${rideable.position.x}, ${rideable.position.y}, ${rideable.position.z}`);
      return true;
    } catch (error) {
      console.log(`Failed to saddle animal: ${error}`);
      return false;
    }
  }
  
  console.log(`Unrecognized vehicle type: ${vehicleType}`);
  return false;
}
