// Path: src/actions/CraftWoodenTools.ts

import { z } from "zod";
import { bot } from "../index";
import { craftRecipe } from "../actions/crafting";
import { ensurePlanks, ensureSticks } from "../actions/ensure";
import { getItemCount } from "../actions/inventory";

export const description = `Important action to build initial tools for the bot. Users can specify the number of each tool to craft. 
If no parameters are provided, the bot will craft 1 pickaxe and 1 axe. Example usage: 
"Craft wooden tools: 2 pickaxes, 1 axe.", "Please craft basic tools", "Make an axe and a shovel", "Craft wooden pickaxe"`;

export const parameters = z.object({
  toolCount: z
    .object({
      pickaxe: z.number().optional(),
      axe: z.number().optional(),
      sword: z.number().optional(),
      shovel: z.number().optional(),
    })
    .optional()
    .describe("The number of each tool to craft."),
});

// Implement the CraftWoodenTools action
export async function execute(args: any) {
  console.log(`Executing CraftWoodenTools with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for CraftWoodenTools:`, parsed.error);
    return;
  }

  let { toolCount } = parsed.data;
  // Default values for toolCount
  toolCount = toolCount || { pickaxe: 1, axe: 1, sword: 0, shovel: 0 };

  try {
    // Check existing wooden tools and adjust toolCount
    const existingToolCounts = {
      pickaxe: getItemCount("wooden_pickaxe"),
      axe: getItemCount("wooden_axe"),
      sword: getItemCount("wooden_sword"),
      shovel: getItemCount("wooden_shovel"),
    };

    toolCount.pickaxe = Math.max(
      0,
      (toolCount.pickaxe || 0) - existingToolCounts.pickaxe
    );
    toolCount.axe = Math.max(0, (toolCount.axe || 0) - existingToolCounts.axe);
    toolCount.sword = Math.max(
      0,
      (toolCount.sword || 0) - existingToolCounts.sword
    );
    toolCount.shovel = Math.max(
      0,
      (toolCount.shovel || 0) - existingToolCounts.shovel
    );

    // If no tools need to be crafted, exit
    if (Object.values(toolCount).every((count) => count === 0)) {
      console.log("Bot: Already have all the required tools.");
      bot.chat("I already have all the required tools.");
      return;
    }

    // Calculate required materials
    const requiredPlanks =
      (toolCount.pickaxe || 0) * 3 +
      (toolCount.axe || 0) * 3 +
      (toolCount.shovel || 0) * 1 +
      (toolCount.sword || 0) * 2;

    const requiredSticks =
      (toolCount.pickaxe || 0) * 2 +
      (toolCount.axe || 0) * 2 +
      (toolCount.shovel || 0) * 2 +
      (toolCount.sword || 0) * 1;

    // Ensure enough planks
    const planksEnsured = await ensurePlanks(
      requiredPlanks + Math.ceil(requiredSticks / 4) * 2
    );
    if (!planksEnsured) {
      console.error("Failed to ensure enough planks.");
      return;
    }

    // Ensure enough sticks
    const sticksEnsured = await ensureSticks(requiredSticks);
    if (!sticksEnsured) {
      console.error("Failed to ensure enough sticks.");
      return;
    }

    // Craft wooden tools
    const toolsToCraft = [
      { name: "wooden_pickaxe", count: toolCount.pickaxe || 0 },
      { name: "wooden_axe", count: toolCount.axe || 0 },
      { name: "wooden_sword", count: toolCount.sword || 0 },
      { name: "wooden_shovel", count: toolCount.shovel || 0 },
    ];

    for (const tool of toolsToCraft) {
      if (tool.count > 0) {
        const crafted = await craftRecipe(tool.name, tool.count);
        if (!crafted) {
          console.error(`Failed to craft ${tool.name}.`);
          return;
        }
      }
    }

    console.log("Bot: All required wooden tools have been crafted!");
    bot.chat("All required wooden tools have been crafted!");
  } catch (error) {
    console.error("Error occurred during tool crafting:", error);
  }
}
