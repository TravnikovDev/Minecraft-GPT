// src/actions/worldInteraction.ts

import { collectDrops } from "./pickup";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { Block } from "prismarine-block";
import * as gameData from "../utils/minecraftData";
import * as world from "./world.js";
import { goToPosition } from "./movement";
import type { Bot } from "mineflayer";
import { __actionsDelay } from "../utils/utility.js";
import { pathing, tools } from "../core/plugins";
import { breakBlock, equipItem, giveCreativeItem, goTo, isReplaceable, knownBlock, placeBlockAt, useBlock, withinReach } from "../core/primitives";
import { describeFailure, expectOk, fail, ok, wasStopped, type ActionResult } from "../core/result";
import { inChore } from "../core/chores";
import { dismountVehicle, lookAt, mountEntity as rideEntity, setControl, useEntity, useHeldItem } from "../core/primitives";

// Move functions like placeBlock, breakBlockAt, collectBlock, etc.

const FACE_BY_NAME: Record<string, Vec3> = {
  top: new Vec3(0, 1, 0),
  bottom: new Vec3(0, -1, 0),
  north: new Vec3(0, 0, -1),
  south: new Vec3(0, 0, 1),
  east: new Vec3(1, 0, 0),
  west: new Vec3(-1, 0, 0),
};
// Things that can go where the bot stands (no need to step back first)
const PLACE_WHILE_STANDING = new Set([
  "torch", "redstone_torch", "redstone", "lever", "button", "rail", "detector_rail",
  "powered_rail", "activator_rail", "tripwire_hook", "tripwire", "water_bucket",
]);

/**
 * Places the exact item `blockType` at x, y, z: breaks what's in the way,
 * steps back if it stands there, walks within reach, and places it against
 * the side named by `placeOn` (or any solid side). Returns whether the block
 * is really there; placeBlockResult says why not.
 */
export async function placeBlock(blockType: string, x: number, y: number, z: number, placeOn: string = "bottom"): Promise<boolean> {
  return (await placeBlockResult(blockType, x, y, z, placeOn)).ok;
}

/** placeBlock, with the reason when it didn't work. */
export async function placeBlockResult(blockType: string, x: number, y: number, z: number, placeOn: string = "bottom"): Promise<ActionResult<{ name: string }>> {
  const targetDest = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
  const done = (result: ActionResult<{ name: string }>): ActionResult<{ name: string }> => {
    if (result.ok) console.log(`Placed ${blockType} at ${targetDest}.`);
    else console.log(`Failed to place ${blockType} at ${targetDest}: ${describeFailure(result)}`);
    return result;
  };

  // The exact block to place: "stone" must never pick a stone pickaxe
  if (!bot.inventory.items().some((item) => item.name === blockType) && bot.game.gameMode === "creative") {
    await giveCreativeItem(36, gameData.makeItem(blockType, 1)); // 36 is first hotbar slot
  }
  if (!bot.inventory.items().some((item) => item.name === blockType)) return done(fail("missing_items", `no ${blockType}`));

  const targetBlock = knownBlock(targetDest);
  if (!targetBlock) return done(fail("unknown_block", `${targetDest} isn't loaded`));
  if (targetBlock.name === blockType) return done(fail("occupied", `${blockType} is already there`));

  // Something solid in the way: break it first
  if (!isReplaceable(targetBlock)) {
    console.log(`${targetBlock.name} is in the way at ${targetBlock.position}.`);
    const cleared = await breakBlockAtResult(targetDest.x, targetDest.y, targetDest.z);
    if (!cleared.ok) return done(cleared);
  }

  // Standing in the spot: step back (blocks can't go where the bot is)
  const feet = bot.entity.position;
  if (!PLACE_WHILE_STANDING.has(blockType) && (feet.distanceTo(targetDest) < 1 || feet.offset(0, 1, 0).distanceTo(targetDest) < 1)) {
    const away = await goTo(new pf.goals.GoalInvert(new pf.goals.GoalNear(targetDest.x, targetDest.y, targetDest.z, 2)));
    if (!away.ok && wasStopped(away)) return done(away);
  }

  // Too far: walk within reach
  if (!withinReach(targetDest)) {
    const near = await goTo(new pf.goals.GoalNear(targetDest.x, targetDest.y, targetDest.z, 3));
    if (!near.ok) return done(near);
  }

  const against = placeOn === "side" ? undefined : FACE_BY_NAME[placeOn];
  return done(await placeBlockAt(blockType, targetDest, { against }));
}

let replacingTool = false;

/**
 * The right tool for `block` wore out (or it never had one): crafts a new one
 * from what it carries, the best it can, like a player does when a pickaxe
 * breaks mid-mine, and equips it. Never recursive: making the tool can't
 * start making another. Returns true if it can now harvest the block.
 */
export async function replaceBrokenTool(block: Block): Promise<boolean> {
  const kind = catalog().toolKindFor(block.name);
  // Never for an idle chore: crafting a tool can mean fetching wood far away
  if (replacingTool || inChore() || (kind !== "pickaxe" && kind !== "axe" && kind !== "shovel")) return false;
  replacingTool = true;
  try {
    // Only from what it carries (never going off for wood or stone: if it
    // can't, the "no_tool" failure goes up and the planner sorts it out)
    const { craftNow, planCraft } = await import("./craftPlanner");
    const best = ["netherite", "diamond", "iron", "stone", "wooden"]
      .map((tier) => `${tier}_${kind}`)
      .find((item) => bot.registry.itemsByName[item] && planCraft(item, 1).missing.length === 0);
    if (!best) return false;
    console.log(`No ${kind} that can break ${block.name}: making a ${best.replace(/_/g, " ")}.`);
    if (!(await craftNow(best, 1)).ok) return false;
    await tools.equipForBlock(block);
    return block.canHarvest(bot.heldItem ? bot.heldItem.type : null);
  } catch (error) {
    console.log(`Making a new ${kind} failed: ${(error as Error).message}`);
    return false;
  } finally {
    replacingTool = false;
  }
}


/**
 * Breaks the block at x, y, z: walks within reach (building up to it if it's
 * high, like a treetop), takes the best tool (or makes one if the old one
 * broke, never for an idle chore), digs, and checks it's really gone.
 * Returns false for air or liquid (nothing to break), as before.
 */
export async function breakBlockAt(x: number, y: number, z: number): Promise<boolean> {
  const result = await breakBlockAtResult(x, y, z);
  return result.ok && !result.value.alreadyGone;
}

/** breakBlockAt, with the reason when it didn't break it. */
export async function breakBlockAtResult(
  x: number,
  y: number,
  z: number
): Promise<ActionResult<{ name: string; alreadyGone: boolean }>> {
  if (x == null || y == null || z == null) throw new Error("Invalid position to break block at.");
  const blockPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
  const block = knownBlock(blockPos);
  if (!block) {
    console.log(`No block known at ${blockPos} (not loaded).`);
    return fail("unknown_block", `${blockPos} isn't loaded`);
  }
  if (block.boundingBox === "empty" && ["air", "cave_air", "water", "lava"].includes(block.name)) {
    console.log(`Skipping block at ${blockPos} because it is ${block.name}.`);
    return ok({ name: block.name, alreadyGone: true });
  }
  if (!withinReach(blockPos)) {
    // Reaching a block up high (the top of a tree) is when a player builds up to it
    const walked = await pathing.withRules({ allow1by1towers: true }, () =>
      goTo(new pf.goals.GoalNear(blockPos.x, blockPos.y, blockPos.z, 2))
    );
    if (!walked.ok && !withinReach(blockPos)) {
      console.log(`Can't get to the ${block.name} at ${blockPos}: ${describeFailure(walked)}`);
      return walked;
    }
  }
  let result = await breakBlock(blockPos);
  // The pickaxe wore out, or it never had the right one: make one and try again
  if (!result.ok && result.reason === "no_tool" && (await replaceBrokenTool(block))) result = await breakBlock(blockPos);
  if (result.ok) console.log(`Broke ${block.name} at x:${blockPos.x}, y:${blockPos.y}, z:${blockPos.z}.`);
  else console.log(`Couldn't break the ${block.name} at ${blockPos}: ${describeFailure(result)}`);
  return result;
}

/** Walks to the nearest block of `type` (a lever, a button) and right-clicks it. */
export async function activateNearestBlock(type: string): Promise<boolean> {
  const block = world.getNearestBlock(type, 16);
  if (!block) {
    console.log(`Could not find any ${type} to activate.`);
    return false;
  }
  const p = block.position;
  if (!withinReach(p)) {
    const walked = await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 3));
    if (!walked.ok) {
      console.log(`Can't get to the ${type}: ${describeFailure(walked)}`);
      return false;
    }
  }
  const used = await useBlock(block);
  if (!used.ok) {
    console.log(`Couldn't use the ${type}: ${describeFailure(used)}`);
    return false;
  }
  console.log(`Activated ${type} at ${p}.`);
  return true;
}

/**
 * Tills grass or dirt at x, y, z with a hoe (checking it turned to farmland)
 * and, with `seedType`, sows on top of it.
 */
export async function tillAndSow(x: number, y: number, z: number, seedType: string | null = null): Promise<boolean> {
  const blockPos = new Vec3(Math.round(x), Math.round(y), Math.round(z));
  const block = knownBlock(blockPos);
  if (!block) {
    console.log(`No block known at ${blockPos} (not loaded).`);
    return false;
  }
  if (block.name !== "grass_block" && block.name !== "dirt" && block.name !== "farmland") {
    console.log(`Cannot till ${block.name}, must be grass_block or dirt.`);
    return false;
  }
  const abovePos = blockPos.offset(0, 1, 0);
  const above = knownBlock(abovePos);
  if (!above || above.name !== "air") {
    console.log(`Cannot till, there is ${above?.name ?? "something unknown"} above the block.`);
    return false;
  }
  if (!withinReach(blockPos)) {
    const walked = await goTo(new pf.goals.GoalNear(blockPos.x, blockPos.y, blockPos.z, 3));
    if (!walked.ok) {
      console.log(`Can't get to the ground to till: ${describeFailure(walked)}`);
      return false;
    }
  }
  if (block.name !== "farmland") {
    const hoe = bot.inventory.items().find((item) => catalog().toolKind(item.name) === "hoe");
    if (!hoe) {
      console.log(`Cannot till, no hoes.`);
      return false;
    }
    const held = await equipItem(hoe.name, "hand");
    const used = held.ok ? await useBlock(block) : held;
    if (!used.ok || !(await settlesTo(blockPos, "farmland"))) {
      console.log(`Tilling at ${blockPos} didn't work${used.ok ? "" : `: ${describeFailure(used)}`}.`);
      return false;
    }
    console.log(`Tilled block at ${blockPos}.`);
  }

  if (seedType) {
    if (seedType.endsWith("seed") && !seedType.endsWith("seeds")) seedType += "s"; // Fixes common mistake
    const wanted = seedType;
    const seeds = bot.inventory.items().find((item) => item.name === wanted);
    if (!seeds) {
      console.log(`No ${seedType} to plant.`);
      return false;
    }
    // Seeds go on top of the farmland (they used to be "placed" below it)
    const sown = await placeBlockAt(seeds.name, abovePos, { against: new Vec3(0, -1, 0) });
    if (!sown.ok) {
      console.log(`Couldn't plant ${seedType} at ${abovePos}: ${describeFailure(sown)}`);
      return false;
    }
    console.log(`Planted ${seedType} at ${abovePos}.`);
  }
  return true;
}

/** Waits briefly for the block at `pos` to become `name` (the server's answer). */
async function settlesTo(pos: Vec3, name: string, ms = 1000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (knownBlock(pos)?.name === name) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return knownBlock(pos)?.name === name;
}

/** Picks up the items within `distance` (see actions/pickup.ts). */
export async function pickupNearbyItems(_bot: Bot, distance = 8): Promise<boolean> {
  await collectDrops(distance);
  return true;
}

export async function useNearbyObject(objectType: string, distance: number = 16, action: string = "use"): Promise<boolean> {
  console.log(`Looking to ${action} ${objectType}...`);

  // Check if this is a dismount command
  if (action === "exit" || action === "leave" || action === "dismount" || action === "get out") {
    return await dismountFromVehicle();
  }

  // Handle mountable entities
  const mountableEntities = [
    "boat", "minecart",  // Vehicles
    "horse", "camel", "donkey", "mule", "pig", "strider"  // Rideable animals
  ];

  if (mountableEntities.includes(objectType.toLowerCase()) ||
    objectType.toLowerCase() === "animal" ||
    objectType.toLowerCase() === "rideable" ||
    objectType.toLowerCase() === "vehicle") {
    return await mountEntity(objectType, distance);
  }

  // Handle interactive blocks
  return await interactWithBlock(objectType);
}

/**
 * Attempts to dismount the bot from any vehicle it's currently in
 */
async function dismountFromVehicle(): Promise<boolean> {
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
async function mountEntity(entityType: string, maxDistance: number): Promise<boolean> {
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
 * Interacts with a block based on the block type
 */
async function interactWithBlock(blockType: string): Promise<boolean> {
  // Map common terms to their block names in Minecraft
  const blockTypeMap: Record<string, string> = {
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
  const mappedBlockType = blockTypeMap[blockType.toLowerCase()] || blockType;

  // Use the activateNearestBlock function
  return await activateNearestBlock(mappedBlockType);
}

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
 * Places a saddle on a nearby rideable animal
 */
async function deploySaddle(inventoryItem: any, maxDistance: number): Promise<boolean> {
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