// Path: src/commands/AttackNearest.ts

import { z } from "zod";
import { bot } from "../core/body";
import { Entity } from "prismarine-entity";
import { attackEntity, getPriorityTargets } from "../actions/combat";

export const description = `The user asks the bot to attack the nearest mob of a given type. The bot will search for the
nearest mob of the given type and attack it using intelligent tactics. Example: "Attack the nearest zombie.", "Please hit the nearest creeper.", "Attack the closest hostile mob."`;

// Define parameters for the AttackNearest action
export const parameters = z.object({
  mobType: z.string().nullable().describe("The type of mob to attack."),
  range: z.number().nullable().describe("Maximum range to search for mobs. Default is 16 blocks."),
});

// Implement the AttackNearest action
export async function execute(args: any) {
  console.log(`Executing AttackNearest with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Missing or invalid parameters for AttackNearest.`);
    return;
  }

  const { mobType } = parsed.data;
  const range = parsed.data.range ?? 16;

  let targetMob: Entity | null = null;

  // If a specific mob type is requested
  if (mobType) {
    // Find the nearest mob of the given type
    const entities: Entity[] = Object.values(bot.entities).filter(
      (entity) =>
        entity.name?.toLowerCase().includes(mobType.toLowerCase()) && 
        entity.type === "mob" &&
        entity.position.distanceTo(bot.entity.position) <= range
    );

    if (entities.length === 0) {
      bot.chat(`Could not find any ${mobType} to attack within ${range} blocks.`);
      return;
    }

    // Sort entities by distance to find the nearest one
    entities.sort(
      (a, b) =>
        a.position.distanceTo(bot.entity.position) -
        b.position.distanceTo(bot.entity.position)
    );
    targetMob = entities[0];
  } else {
    // No specific mob type, attack nearest hostile
    const hostiles = getPriorityTargets(range);
    
    if (hostiles.length > 0) {
      targetMob = hostiles[0];
      bot.chat(`Attacking the most threatening hostile mob: ${targetMob.name}!`);
    } else {
      // If no hostiles, find any mob
      const anyMob = Object.values(bot.entities).filter(
        entity => entity.type === "mob" && 
                  entity.position.distanceTo(bot.entity.position) <= range
      );
      
      if (anyMob.length > 0) {
        anyMob.sort(
          (a, b) =>
            a.position.distanceTo(bot.entity.position) -
            b.position.distanceTo(bot.entity.position)
        );
        targetMob = anyMob[0];
        bot.chat(`No hostiles found. Attacking the nearest mob: ${targetMob.name}!`);
      }
    }
  }

  // Attack the target if found
  if (targetMob) {
    try {
      await attackEntity(targetMob); // Use our enhanced attack function
    } catch (error) {
      console.error(`Failed to attack the mob:`, error);
      bot.chat(`Failed to attack the target.`);
    }
  } else {
    bot.chat(`No suitable mobs found to attack within ${range} blocks.`);
  }
}
