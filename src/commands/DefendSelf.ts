import type { Bot } from "mineflayer";
import { Entity } from "prismarine-entity";
import { goals, Movements } from "mineflayer-pathfinder";
import { z } from "zod";
import { bot } from "../index";
import { getAttackDamage } from "../utils/utility";

export const description = `The user asks the bot to defend itself from nearby enemies. The bot will attack any hostile 
mobs within a certain range. Example: "Defend self within 10 blocks.", "Protect yourself.". If no arguments are provided, bot will 20 block distance.`;

// Define parameters for the DefendSelf action
export const parameters = z.object({
  range: z
    .number()
    .optional()
    .describe("The range within which to detect enemies."),
});

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
  return (
    entity.displayName !== undefined && hostileMobs.includes(entity.displayName)
  );
}

// Function to equip the highest attack damage item
async function equipHighestAttack(bot: Bot) {
  const items = bot.inventory.items();
  const swords = items.filter((item) => item.name.includes("sword"));
  if (swords.length > 0) {
    swords.sort((a, b) => getAttackDamage(b) - getAttackDamage(a));
    await bot.equip(swords[0], "hand");
  }
}

// Implement the DefendSelf action
export async function execute(args: any) {
  console.log(`Executing DefendSelf with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Missing parameters for DefendSelf: range is undefined.`);
    return;
  }

  let { range } = parsed.data;
  range = range || 20; // Default range to search for enemies

  let attacked = false;
  let enemy = getNearestEntityWhere(
    bot,
    (entity: Entity) => isHostile(entity),
    range
  );

  while (enemy) {
    await equipHighestAttack(bot);
    if (
      bot.entity.position.distanceTo(enemy.position) > 4 &&
      enemy.name !== "creeper" &&
      enemy.name !== "phantom"
    ) {
      try {
        bot.pathfinder.setMovements(new Movements(bot));
        await bot.pathfinder.goto(new goals.GoalFollow(enemy, 2));
      } catch (err) {
        // Might error if entity dies, ignore
      }
    }
    bot.pvp.attack(enemy);
    attacked = true;
    await new Promise((resolve) => setTimeout(resolve, 500));
    enemy = getNearestEntityWhere(
      bot,
      (entity: Entity) => isHostile(entity),
      range
    );
  }
  bot.pvp.stop();
  if (attacked) {
    console.log(`Successfully defended self.`);
  } else {
    console.log(`No enemies nearby to defend self from.`);
  }
}
