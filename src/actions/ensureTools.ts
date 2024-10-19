/*
    Purpose: This file will store various functions used to ensure the bot has needed items for in-game actions.
*/

import { bot } from "..";
import { craftRecipe } from "./crafting";
import { ensureCraftingTable, ensurePlanks, ensureSticks } from "./ensure";
import { getItemCount } from "./inventory";

// Define the valid tool types as a union type
type ToolType = "pickaxe" | "sword" | "axe" | "shovel" | "hoe";

// Define the valid materials as a union type
type MaterialType = "diamond" | "golden" | "iron" | "stone" | "wooden";

// Constants for crafting tools
const TOOLS_MATERIALS: MaterialType[] = [
  "diamond",
  "golden",
  "iron",
  "stone",
  "wooden",
];

export const materialsForTool = (tool: ToolType): number => {
  switch (tool) {
    case "pickaxe":
    case "axe":
      return 3;
    case "sword":
    case "hoe":
      return 2;
    case "shovel":
      return 1;
    default:
      return 0;
  }
};

// Helper function to ensure a specific tool, checking from best materials to wood
const ensureTool = async (
  toolType: ToolType,
  quantity: number = 1
): Promise<boolean> => {
  console.log(`Bot: Checking for ${quantity} ${toolType}(s)...`);

  const neededMaterials = materialsForTool(toolType);

  // Check how many of the tool the bot currently has
  let toolCount = bot.inventory
    .items()
    .filter((item) => item.name.includes(toolType)).length;

  if (toolCount >= quantity) {
    console.log(`Bot: Already has ${quantity} or more ${toolType}(s).`);
    return true;
  }

  while (toolCount < quantity) {
    // Iterate over the tool materials from best (diamond) to worst (wooden)
    for (const material of TOOLS_MATERIALS) {
      const toolRecipe = `${material}_${toolType}`; // Craft tool name like diamond_pickaxe, iron_sword
      const hasResources = await hasResourcesForTool(material, neededMaterials);

      // Check if we have enough material for the current tool
      if (hasResources) {
        await ensureCraftingTable();

        const sticksEnsured = await ensureSticks(2);

        if (!sticksEnsured) {
          console.error(
            `Bot: Failed to ensure planks or sticks for wooden ${toolType}.`
          );
          continue;
        }

        // Craft the tool
        const crafted = await craftRecipe(toolRecipe, 1);
        if (crafted) {
          toolCount++;
          bot.chat(
            `I have crafted a ${material} ${toolType}. Total ${toolType}(s): ${toolCount}/${quantity}`
          );
          console.log(
            `Bot: ${material} ${toolType} crafted. Total ${toolCount}/${quantity}`
          );
          if (toolCount >= quantity) return true;
        } else {
          console.error(`Bot: Failed to craft ${material} ${toolType}.`);
        }
      } else if (material === "wooden") {
        // Crafting planks if we don't have enough resources for wooden tools
        console.log(`Bot: Crafting planks for ${material} ${toolType}...`);
        await ensurePlanks(4);
      }
    }
  }

  return toolCount >= quantity;
};

// Helper function to check if the bot has enough materials to craft a tool of a specific material
export async function hasResourcesForTool(
  material: MaterialType,
  num = 3 // Number of resources needed for most tools
): Promise<boolean> {
  switch (material) {
    case "diamond":
      return getItemCount("diamond") >= num;
    case "golden":
      return getItemCount("gold_ingot") >= num;
    case "iron":
      return getItemCount("iron_ingot") >= num;
    case "stone":
      return getItemCount("cobblestone") >= num;
    case "wooden":
      return getItemCount("planks") >= num;
    default:
      return false;
  }
}

// Helper functions for specific tools:

// Ensure a pickaxe
export const ensurePickaxe = async (quantity: number = 1): Promise<boolean> => {
  return await ensureTool("pickaxe", quantity);
};

// Ensure a sword
export const ensureSword = async (quantity: number = 1): Promise<boolean> => {
  return await ensureTool("sword", quantity);
};

// Ensure an axe
export const ensureAxe = async (quantity: number = 1): Promise<boolean> => {
  return await ensureTool("axe", quantity);
};

// Ensure a shovel
export const ensureShovel = async (quantity: number = 1): Promise<boolean> => {
  return await ensureTool("shovel", quantity);
};

export const ensureHoe = async (quantity: number = 1): Promise<boolean> => {
  return await ensureTool("hoe", quantity);
};
