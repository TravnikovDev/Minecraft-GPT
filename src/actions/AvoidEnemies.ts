// Path: src/actions/AvoidEnemies.ts

import { z } from "zod";
import { BotActions } from "./types";
import { bot } from "../index";
import { goals, Movements } from "mineflayer-pathfinder";
import { Entity } from "prismarine-entity";
import { Bot } from "mineflayer";

// Define parameters for the AvoidEnemies action
export const parameters = z.object({
  distance: z.number().describe("The distance to maintain from enemies."),
});

// Register the action with zodFunction for validation
export const AvoidEnemiesFunction = {
  name: BotActions.AvoidEnemies,
  parameters: parameters,
};

// Implement the AvoidEnemies action

// Function to get the nearest entity that meets a certain condition
function getNearestEntityWhere(
  bot: Bot,
  condition: (entity: Entity) => boolean,
  maxDistance: number
): Entity | null {
  const entities = Object.values(bot.entities);
  const filteredEntities = entities.filter(
    (entity) =>
      condition(entity) &&
      bot.entity.position.distanceTo(entity.position) <= maxDistance
  );
  filteredEntities.sort(
    (a, b) =>
      bot.entity.position.distanceTo(a.position) -
      bot.entity.position.distanceTo(b.position)
  );
  return filteredEntities.length > 0 ? filteredEntities[0] : null;
}

// Function to check if an entity is hostile
function isHostile(entity: Entity): boolean {
  const hostileMobs = [
    "Zombie",
    "Skeleton",
    "Creeper",
    "Spider",
    "Enderman",
    "Witch",
  ];
  return entity.mobType !== undefined && hostileMobs.includes(entity.mobType);
}

// Usage in executeAvoidEnemies function
export async function execute(args: any) {
  console.log(`Executing AvoidEnemies with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(
      `Missing parameters for AvoidEnemies: distance is undefined.`
    );
    return;
  }

  const { distance } = parsed.data;
  let enemy = getNearestEntityWhere(
    bot,
    (entity: Entity) => isHostile(entity),
    distance
  );

  while (enemy) {
    const follow = new goals.GoalFollow(enemy, distance + 1); // Move a little further away
    const invertedGoal = new goals.GoalInvert(follow);
    bot.pathfinder.setMovements(new Movements(bot));
    bot.pathfinder.setGoal(invertedGoal, true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    enemy = getNearestEntityWhere(
      bot,
      (entity: Entity) => isHostile(entity),
      distance
    );
  }

  bot.pathfinder.stop();
  console.log(`Moved ${distance} away from enemies.`);
}
