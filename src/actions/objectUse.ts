// Path: src/actions/objectUse.ts
// Using a nearby object by name: rides vehicles and animals, or right-clicks a block (lever, button, door...).

import pf from "mineflayer-pathfinder";
import * as world from "./world.js";
import { goTo, useBlock, withinReach } from "../core/primitives";
import { describeFailure } from "../core/result";
import { dismountFromVehicle, mountEntity } from "./riding";

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
