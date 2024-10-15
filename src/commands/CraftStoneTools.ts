// Path: src/actions/CraftStoneTools.ts

import { z } from "zod";
import { bot } from "../index";
import { craftRecipe } from "../actions/crafting";
import { gatherWood } from "../actions/gatherWood";
import { moveAway } from "../actions/movement";
import { __actionsDelay } from "../utils/utility";
import { collectBlock } from "../actions/collectBlock";

export const description = `Important action to build stone tools for the bot. The user can specify the number of each tool to craft. 
If no parameters are provided, the bot will craft 2 pickaxes, 1 axe, 0 sword, and 1 shovel. Example usage: 
"Craft stone tools: 2 pickaxes, 1 axe.", "Please craft stone tools", "Make a stone axe and a shovel"
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
    const pica = await ensurePickaxe();
    if (pica) {
      bot.chat("I have a  pickaxe. Let's gather some cobblestone!");
    }

    // Check existing stone tools and adjust toolCount
    const existingToolCounts = {
      pickaxe: 0,
      axe: 0,
      sword: 0,
      shovel: 0,
    };

    bot.inventory.items().forEach((item) => {
      if (item.name === "stone_pickaxe")
        existingToolCounts.pickaxe += item.count;
      else if (item.name === "stone_axe") existingToolCounts.axe += item.count;
      else if (item.name === "stone_sword")
        existingToolCounts.sword += item.count;
      else if (item.name === "stone_shovel")
        existingToolCounts.shovel += item.count;
    });

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
      toolCount.pickaxe * 3 +
      toolCount.axe * 3 +
      toolCount.shovel * 1 +
      toolCount.sword * 2;

    await gatherCobblestone(requiredCobblestone);

    // Ensure enough sticks
    const requiredSticks =
      toolCount.pickaxe * 2 +
      toolCount.axe * 2 +
      toolCount.shovel * 2 +
      toolCount.sword * 1;

    let sticksCount = bot.inventory
      .items()
      .filter((item) => item.name.includes("stick"))
      .reduce((acc, item) => acc + item.count, 0);

    if (sticksCount < requiredSticks) {
      const sticksShortage = requiredSticks - sticksCount;
      await gatherWood(1); // Collect an extra log for sticks
      await craftRecipe("stick", sticksShortage);
    }

    // Craft stone tools
    if (toolCount.pickaxe)
      await craftRecipe("stone_pickaxe", toolCount.pickaxe);
    if (toolCount.axe) await craftRecipe("stone_axe", toolCount.axe);
    if (toolCount.sword) await craftRecipe("stone_sword", toolCount.sword);
    if (toolCount.shovel) await craftRecipe("stone_shovel", toolCount.shovel);

    console.log("Bot: All required stone tools have been crafted!");
  } catch (error) {
    console.error("Error occurred during tool crafting:", error);
  }
}

// Helper function to ensure a wooden pickaxe
const ensurePickaxe = async (): Promise<boolean> => {
  console.log("Checking for a pickaxe...");
  let hasPickaxe: boolean = bot.inventory
    .items()
    .some((item) => item.name.includes("pickaxe"));

  if (hasPickaxe) {
    console.log("Bot: Pickaxe is available.");
    return true;
  }

  while (!hasPickaxe) {
    const logs = bot.inventory
      .items()
      .filter((item) => item.name.includes("log"));
    const logsCount = logs.reduce((acc, item) => acc + item.count, 0);

    if (logsCount >= 4) {
      const logType = logs[0].name.replace("_log", "");

      const gotPlanks = await craftRecipe(`${logType}_planks`, 12);
      const getStick = await craftRecipe(`Stick`, 8);
      if (!gotPlanks || !getStick) {
        continue;
      }
      hasPickaxe = await craftRecipe("Wooden_pickaxe", 1);
      bot.chat("I have crafted a wooden pickaxe.");
      console.log("Bot: Wooden pickaxe crafted.");
    } else {
      await gatherWood(5);
      console.error("Bot: No logs available to craft wooden pickaxe.");
      continue;
    }
  }

  return hasPickaxe;
};

// Helper function to gather cobblestone
const gatherCobblestone = async (
  requiredCobblestone: number
): Promise<boolean> => {
  let cobblestoneCount = bot.inventory
    .items()
    .filter((item) => item.name.includes("cobblestone"))
    .reduce((acc, item) => acc + item.count, 0);

  if (cobblestoneCount >= requiredCobblestone) {
    console.log("Bot: Collected enough cobblestone.");
    return true;
  }

  console.log("Bot: Gathering more cobblestone...");
  const cobblestoneShortage = requiredCobblestone - cobblestoneCount;
  const collected = await collectBlock("stone", cobblestoneShortage, 5).catch(
    async (err) => {
      if (err.includes("right tools")) {
        await ensurePickaxe();
      }
    }
  );

  console.log("Bot: Collected cobblestone:", collected);

  if (!collected) {
    await moveAway(15);
    await __actionsDelay();
    // Recursively try gathering cobblestone again
    return gatherCobblestone(requiredCobblestone);
  } else {
    // Recursively check if we've gathered enough cobblestone now
    return gatherCobblestone(requiredCobblestone);
  }
};
