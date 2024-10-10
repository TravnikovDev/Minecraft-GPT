// Path: src/actions/CraftWoodenTools.ts

import { z } from "zod";
import { bot } from "../index";
import { goals } from "mineflayer-pathfinder";

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
  const requiredPlanks = 12 * Number(toolCount); // Minimum planks required for tools and crafting table
  const requiredSticks = 8 * Number(toolCount); // Minimum sticks required for tools

  const planksCount = bot.inventory.count("oak_planks", null);
  const sticksCount = bot.inventory.count("stick", null);

  // Check for sufficient materials and craft if needed
  if (planksCount < requiredPlanks) {
    const logsCount = bot.inventory.count("oak_log", null);
    const logsNeeded = Math.ceil((requiredPlanks - planksCount) / 4); // 1 log crafts 4 planks

    if (logsCount < logsNeeded) {
      console.log("Bot: Not enough logs to craft the required planks.");
      return;
    }

    const plankRecipe = bot.recipesFor(
      bot.registry.itemsByName["oak_planks"].id,
      null,
      1,
      null
    )[0];
    if (plankRecipe) {
      await bot.craft(plankRecipe, logsNeeded);
      console.log(`Bot: Crafted ${logsNeeded * 4} planks.`);
    } else {
      console.log("Bot: Could not find a recipe for planks.");
      return;
    }
  }

  if (sticksCount < requiredSticks) {
    const planksNeededForSticks = Math.ceil((requiredSticks - sticksCount) / 4); // 2 planks craft 4 sticks

    if (planksCount < planksNeededForSticks) {
      console.log("Bot: Not enough planks to craft the required sticks.");
      return;
    }

    const stickRecipe = bot.recipesFor(
      bot.registry.itemsByName["stick"].id,
      null,
      1,
      null
    )[0];
    if (stickRecipe) {
      await bot.craft(stickRecipe, planksNeededForSticks);
      console.log(`Bot: Crafted ${planksNeededForSticks * 4} sticks.`);
    } else {
      console.log("Bot: Could not find a recipe for sticks.");
      return;
    }
  }

  // Search for a crafting table within 15 blocks
  const craftingTableBlock = bot.findBlock({
    matching: 58, // ID for crafting table
    maxDistance: 15,
  });

  if (craftingTableBlock) {
    // Move to the crafting table
    bot.pathfinder.setGoal(
      new goals.GoalNear(
        craftingTableBlock.position.x,
        craftingTableBlock.position.y,
        craftingTableBlock.position.z,
        1
      ),
      true
    );
    console.log("Bot: Found and moved to an existing crafting table.");
  } else {
    // Craft a crafting table if none is in inventory
    if (!bot.inventory.items().some((item) => item.name === "crafting_table")) {
      const craftingTableRecipe = bot.recipesFor(
        bot.registry.itemsByName["crafting_table"].id,
        null,
        1,
        null
      )[0];
      if (craftingTableRecipe) {
        await bot.craft(craftingTableRecipe, 1);
        console.log("Bot: Crafted a crafting table.");
      }
    }

    // Place the crafting table nearby
    const craftingTable = bot.inventory
      .items()
      .find((item) => item.type === 58); // ID for crafting table
    if (craftingTable) {
      const craftingTableBlock = bot.blockAt(
        bot.entity.position.offset(0, -1, 0)
      ); // Get the block below the bot
      const position = bot.entity.position.offset(1, 0, 0); // Place next to bot
      const targetBlock = bot.blockAt(position);
      if (targetBlock && craftingTableBlock) {
        await bot.placeBlock(craftingTableBlock, targetBlock.position);
        console.log("Bot: Placed a crafting table.");
      } else {
        console.log(
          "Bot: Could not place the crafting table, no valid block found."
        );
      }
      console.log("Bot: Placed a crafting table.");
    }
  }

  // Function to craft tools
  const toolIds: { [key: string]: number } = {
    wooden_pickaxe: 270,
    wooden_axe: 271,
    wooden_sword: 268,
    wooden_shovel: 269,
  };

  async function craftTool(toolName: string, count: number) {
    const recipe = await bot.recipesFor(
      toolIds[toolName],
      null,
      Number(toolCount),
      null
    )[0];

    console.log(`Crafting ${count} ${toolName}(s)...`);
    console.log(recipe);

    if (recipe) {
      await bot.craft(recipe, count);
      console.log(`Crafted ${count} ${toolName}(s).`);
    } else {
      console.log(`Could not find a recipe for ${toolName}.`);
    }
  }

  // Craft each tool
  await craftTool("wooden_pickaxe", toolCount.pickaxe);
  await craftTool("wooden_axe", toolCount.axe);
  await craftTool("wooden_sword", toolCount.sword);
  await craftTool("wooden_shovel", toolCount.shovel);

  console.log("Bot: All basic wooden tools have been crafted!");
}
