import { z } from "zod";
import { BotActions } from "./types";
import { bot } from "../index";
import { Entity } from "prismarine-entity";
import { goals, Movements } from "mineflayer-pathfinder";
import type { Bot } from "mineflayer";
import { attackEntity } from "../utils/combat";
import { isHuntable } from "../utils/minecraftData";

export const description = `When user asks the bot to hunt, the bot will search for the nearest huntable animal and attack it.
Example: "Hunt for animals within 10 blocks.", "Attack the nearest cow.", "Gather some food", "Kill the chicken", "Hunt for pigs".`;

// Define parameters for the Hunting action
export const parameters = z.object({
  maxDistance: z
    .number()
    .optional()
    .describe("The maximum distance to hunt for animals."),
});

// Register the action with zodFunction for validation
export const HuntingFunction = {
  name: BotActions.Hunting,
  parameters: parameters,
};

// Function to get the nearest entity that meets a certain condition
function getNearestEntityWhere(
  bot: Bot,
  predicate: (entity: Entity) => boolean,
  maxDistance: number = 16
): Entity | null {
  return bot.nearestEntity(
    (entity) =>
      predicate(entity) &&
      bot.entity.position.distanceTo(entity.position) < maxDistance
  );
}

// Implement the Hunting action
export async function execute(args: any) {
  console.log(`Executing Hunting with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Missing parameters for Hunting: maxDistance is undefined.`);
    return;
  }

  let { maxDistance } = parsed.data;
  maxDistance = maxDistance || 64;

  const huntable = getNearestEntityWhere(
    bot,
    (entity: Entity) => isHuntable(entity),
    maxDistance
  );

  console.log(`Found huntable entity:`, huntable);

  if (huntable) {
    const goal = new goals.GoalNear(
      huntable.position.x,
      huntable.position.y,
      huntable.position.z,
      1
    );

    const isClear = bot.pathfinder.getPathTo(new Movements(bot), goal);
    if (isClear && huntable.name) {
      console.log(`Hunting ${huntable.name}!`);
      await attackEntity(huntable);
    }
  } else {
    bot.chat(`No huntable animals nearby.`);
  }
}
