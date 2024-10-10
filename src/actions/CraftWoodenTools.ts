// Path: src/actions/CraftWoodenTools.ts

import { z } from "zod";
import { bot } from "../index";
import { craftRecipe } from "../utils/crafting";

// Define parameters for CraftWoodenTools action
export const parameters = z.object({
  toolCount: z
    .object({
      pickaxe: z.number(),
      axe: z.number(),
      sword: z.number(),
      shovel: z.number(),
    })
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

  const { toolCount } = parsed.data;

  // Check for sufficient materials
  const requiredPlanks =
    12 *
    Number(
      toolCount.axe + toolCount.pickaxe + toolCount.shovel + toolCount.sword
    ); // Minimum planks required for tools and crafting table
  const requiredSticks =
    8 *
    Number(
      toolCount.axe + toolCount.pickaxe + toolCount.shovel + toolCount.sword
    ); // Minimum sticks required for tools

  const planksCount = await bot.inventory
    .items()
    .filter((item) => item.name.includes("plank"))
    .reduce((acc, item) => acc + item.count, 0);
  const sticksCount = await bot.inventory
    .items()
    .filter((item) => item.name.includes("stick"))
    .reduce((acc, item) => acc + item.count, 0);

  console.log(
    "Required planks:",
    requiredPlanks,
    " and sticks:",
    requiredSticks
  );
  console.log("Planks count:", planksCount);
  console.log("Sticks count:", sticksCount);

  // Check for sufficient materials and craft if needed
  if (planksCount < requiredPlanks) {
    const logsCount = await bot.inventory
      .items()
      .filter((item) => item.name.includes("log"))
      .reduce((acc, item) => acc + item.count, 0);
    const logsNeeded = Math.ceil((requiredPlanks - planksCount) / 4); // 1 log crafts 4 planks

    console.log("Logs count:", logsCount, " and logs needed:", logsNeeded);

    if (logsCount < logsNeeded) {
      console.log("Bot: Not enough logs to craft the required planks.");
      return;
    }
    await craftRecipe("oak_planks", requiredPlanks);
  }

  if (sticksCount < requiredSticks) {
    const planksNeededForSticks = Math.ceil((requiredSticks - sticksCount) / 4); // 2 planks craft 4 sticks
    const newPlanksCount = await bot.inventory
      .items()
      .filter((item) => item.name.includes("plank"))
      .reduce((acc, item) => acc + item.count, 0);
    if (newPlanksCount < planksNeededForSticks) {
      console.log("Bot: Not enough planks to craft the required sticks.");
      return;
    }
    await craftRecipe("stick", requiredSticks);
  }

  // Craft each tool
  await craftRecipe("wooden_pickaxe", toolCount.pickaxe);
  await craftRecipe("wooden_axe", toolCount.axe);
  await craftRecipe("wooden_sword", toolCount.sword);
  await craftRecipe("wooden_shovel", toolCount.shovel);

  console.log("Bot: All basic wooden tools have been crafted!");
}
