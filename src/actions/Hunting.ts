import { z } from "zod";
import { BotActions } from "./types";
import { bot } from "../index";
import { Entity } from "prismarine-entity";
import { goals, Movements } from "mineflayer-pathfinder";
import { Bot } from "mineflayer";

// Define parameters for the Hunting action
export const parameters = z.object({
  maxDistance: z.number().describe("The maximum distance to hunt for animals."),
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

// Function to check if an entity is huntable
function isHuntable(mob: Entity): boolean {
  if (!mob || !mob.name) return false;
  const animals: string[] = [
    "chicken",
    "cow",
    "llama",
    "mooshroom",
    "pig",
    "rabbit",
    "sheep",
  ];
  return animals.includes(mob.name.toLowerCase()) && !mob.metadata[16]; // metadata[16] indicates baby status
}

// Function to attack an entity
async function attackEntity(bot: Bot, entity: Entity) {
  await bot.pvp.attack(entity);
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

  const { maxDistance } = parsed.data;
  const huntable = getNearestEntityWhere(
    bot,
    (entity: Entity) => isHuntable(entity),
    maxDistance
  );

  if (huntable) {
    const goal = new goals.GoalNear(
      huntable.position.x,
      huntable.position.y,
      huntable.position.z,
      1
    );
    const isClear = bot.pathfinder.getPathTo(new Movements(bot), goal);
    if (isClear) {
      console.log(`Hunting ${huntable.name}!`);
      await attackEntity(bot, huntable);
    }
  } else {
    bot.chat(`No huntable animals nearby.`);
  }
}
