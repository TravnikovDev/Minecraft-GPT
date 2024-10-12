// Path: src/actions/CraftWoodenTools.ts

import { z } from "zod";
import { bot } from "../index";
import { craftRecipe } from "../utils/crafting";
import { addActionToQueue } from "../managers/persistenceManager";
import { BotActions } from "./types";

export const description = `Important action to build initial tools for the bot. User can specify the number of each tool to craft. 
If no parameters are provided, the bot will craft 3 pickaxes, 2 axes, 1 sword, and 1 shovel. Example usage: 
"Craft wooden tools: 2 pickaxes, 1 axe.", "Please craft basic tools", "Make an axe and a shovel"`;

// Define parameters for CraftWoodenTools action
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
  toolCount = toolCount || { pickaxe: 3, axe: 2, sword: 1, shovel: 1 };

  // Check existing tools in inventory and adjust toolCount
  const existingToolCounts = {
    pickaxe: 0,
    axe: 0,
    sword: 0,
    shovel: 0,
  };

  bot.inventory.items().forEach((item) => {
    if (item.name === "wooden_pickaxe") {
      existingToolCounts.pickaxe += item.count;
    } else if (item.name === "wooden_axe") {
      existingToolCounts.axe += item.count;
    } else if (item.name === "wooden_sword") {
      existingToolCounts.sword += item.count;
    } else if (item.name === "wooden_shovel") {
      existingToolCounts.shovel += item.count;
    }
  });

  // Adjust the toolCount based on existing tools
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
  if (
    toolCount.pickaxe === 0 &&
    toolCount.axe === 0 &&
    toolCount.sword === 0 &&
    toolCount.shovel === 0
  ) {
    console.log("Bot: Already have all the required tools.");
    return;
  }

  // Calculate required materials based on adjusted toolCount
  const requiredPlanks =
    toolCount.pickaxe * 3 +
    toolCount.axe * 3 +
    toolCount.shovel * 1 +
    toolCount.sword * 2;

  const requiredSticks =
    toolCount.pickaxe * 2 +
    toolCount.axe * 2 +
    toolCount.shovel * 2 +
    toolCount.sword * 1;

  // Additional planks needed for sticks
  const planksNeededForSticks = Math.ceil(requiredSticks / 4) * 2; // Each 2 planks crafts 4 sticks
  const totalPlanksNeeded = requiredPlanks + planksNeededForSticks;

  // Check for existing materials
  let planksCount = bot.inventory
    .items()
    .filter((item) => item.name.includes("planks"))
    .reduce((acc, item) => acc + item.count, 0);

  let sticksCount = bot.inventory
    .items()
    .filter((item) => item.name.includes("stick"))
    .reduce((acc, item) => acc + item.count, 0);

  console.log(
    "Required planks:",
    totalPlanksNeeded,
    "and sticks:",
    requiredSticks
  );
  console.log("Planks count:", planksCount);
  console.log("Sticks count:", sticksCount);

  // Check if we need to craft more planks
  if (planksCount < totalPlanksNeeded) {
    const planksShortage = totalPlanksNeeded - planksCount;

    // Check for logs to craft planks
    const logsCount = bot.inventory
      .items()
      .filter((item) => item.name.includes("log"))
      .reduce((acc, item) => acc + item.count, 0);
    const logsNeeded = Math.ceil(planksShortage / 4); // 1 log crafts 4 planks

    console.log("Logs count:", logsCount, " and logs needed:", logsNeeded);

    if (logsCount < logsNeeded) {
      console.log("Bot: Not enough logs to craft the required planks.");
      addActionToQueue({
        id: "gatherWood-" + (logsNeeded - logsCount),
        action: BotActions.GatherWood,
        priority: 7,
        args: { maxDistance: 100, num: logsNeeded - logsCount },
      });
      return;
    }

    await craftRecipe("oak_planks", planksShortage);
    planksCount += planksShortage;
  }

  // Now we should have enough planks
  // Check if we need to craft sticks
  if (sticksCount < requiredSticks) {
    const sticksShortage = requiredSticks - sticksCount;
    const planksAvailableForSticks = planksCount - requiredPlanks;

    const planksNeededForSticks = Math.ceil(sticksShortage / 4) * 2;

    if (planksAvailableForSticks < planksNeededForSticks) {
      const additionalPlanksNeeded =
        planksNeededForSticks - planksAvailableForSticks;

      // Check for logs to craft additional planks
      const logsCount = bot.inventory
        .items()
        .filter((item) => item.name.includes("log"))
        .reduce((acc, item) => acc + item.count, 0);
      const logsNeeded = Math.ceil(additionalPlanksNeeded / 4); // 1 log crafts 4 planks

      if (logsCount < logsNeeded) {
        console.log(
          "Bot: Not enough logs to craft the required planks for sticks."
        );
        addActionToQueue({
          id: "gatherWood-" + (logsNeeded - logsCount),
          action: BotActions.GatherWood,
          priority: 7,
          args: { maxDistance: 100, num: logsNeeded - logsCount },
        });
        return;
      }

      await craftRecipe("oak_planks", additionalPlanksNeeded);
      planksCount += additionalPlanksNeeded;
    }

    // Now craft sticks
    await craftRecipe("stick", sticksShortage);
    sticksCount += sticksShortage;
    planksCount -= planksNeededForSticks;
  }

  // Now we have enough materials to craft the tools
  if (toolCount.pickaxe) {
    await craftRecipe("wooden_pickaxe", toolCount.pickaxe);
  }
  if (toolCount.axe) {
    await craftRecipe("wooden_axe", toolCount.axe);
  }
  if (toolCount.sword) {
    await craftRecipe("wooden_sword", toolCount.sword);
  }
  if (toolCount.shovel) {
    await craftRecipe("wooden_shovel", toolCount.shovel);
  }

  console.log("Bot: All required wooden tools have been crafted!");
}
