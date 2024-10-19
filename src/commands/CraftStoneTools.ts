// Path: src/actions/CraftStoneTools.ts

import { z } from "zod";
import { bot } from "../index";
import { craftRecipe } from "../actions/crafting";
import { __actionsDelay } from "../utils/utility";
import { ensureCobblestone, ensureSticks } from "../actions/ensure";
import { getItemCount } from "../actions/inventory";
import { ensurePickaxe } from "../actions/ensureTools";

export const description = `Important action to build stone tools for the bot. The user can specify the number of each tool to craft. 
If no parameters are provided, the bot will craft 2 pickaxes, 1 axe, 0 sword, and 1 shovel. Example usage: 
"Craft stone tools: 2 pickaxes, 1 axe.", "Please craft stone tools", "Make a stone axe and a shovel", "Make a stone pickaxe".
!important: The default type of tools to craft is stone tools.`;

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

// Implement the CraftStoneTools action
export async function execute(args: any) {
  console.log(`Executing CraftStoneTools with args:`, args);

  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for CraftStoneTools:`, parsed.error);
    return;
  }

  let { toolCount } = parsed.data;
  toolCount = toolCount || { pickaxe: 2, axe: 1, sword: 0, shovel: 1 };

  try {
    // Ensure wooden pickaxe before gathering stone
    const hasPickaxe = await ensurePickaxe();
    if (hasPickaxe) {
      bot.chat("I have a pickaxe. Let's gather some cobblestone!");
    }

    // Check existing stone tools and adjust toolCount
    const existingToolCounts = {
      pickaxe: getItemCount("stone_pickaxe"),
      axe: getItemCount("stone_axe"),
      sword: getItemCount("stone_sword"),
      shovel: getItemCount("stone_shovel"),
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

    if (Object.values(toolCount).every((count) => count === 0)) {
      console.log("Bot: Already have all the required tools.");
      bot.chat("I already have all the required tools.");
      return;
    }

    // Calculate required cobblestone for tools
    const requiredCobblestone =
      (toolCount.pickaxe || 0) * 3 +
      (toolCount.axe || 0) * 3 +
      (toolCount.shovel || 0) * 1 +
      (toolCount.sword || 0) * 2;

    // Gather cobblestone
    const cobblestoneGathered = await ensureCobblestone(requiredCobblestone);
    if (!cobblestoneGathered) {
      console.error("Failed to gather enough cobblestone.");
      return;
    }

    // Ensure enough sticks
    const requiredSticks =
      (toolCount.pickaxe || 0) * 2 +
      (toolCount.axe || 0) * 2 +
      (toolCount.shovel || 0) * 2 +
      (toolCount.sword || 0) * 1;

    const sticksEnsured = await ensureSticks(requiredSticks);
    if (!sticksEnsured) {
      console.error("Failed to ensure enough sticks.");
      return;
    }

    // Craft stone tools
    const toolsToCraft = [
      { name: "stone_pickaxe", count: toolCount.pickaxe || 0 },
      { name: "stone_axe", count: toolCount.axe || 0 },
      { name: "stone_sword", count: toolCount.sword || 0 },
      { name: "stone_shovel", count: toolCount.shovel || 0 },
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

    console.log("Bot: All required stone tools have been crafted!");
    bot.chat("All required stone tools have been crafted!");
  } catch (error) {
    console.error("Error occurred during tool crafting:", error);
  }
}
