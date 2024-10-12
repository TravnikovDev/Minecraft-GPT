// Path: src/actions/AttackNearest.ts

import { z } from "zod";
import { bot } from "../index";
import { Entity } from "prismarine-entity";

export const description = `Then user asks the bot to attack the nearest mob of a given type.  The bot will search for the
 nearest mob of the given type and attack it. Example: "Attack the nearest zombie.", "Please hit the nearest creeper."`;

// Define parameters for the AttackNearest action
export const parameters = z.object({
  mobType: z.string().optional().describe("The type of mob to attack."),
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

  // Find the nearest mob of the given type
  const entities: Entity[] = Object.values(bot.entities).filter(
    (entity) => entity.name === mobType && entity.type === "mob"
  );

  if (entities.length === 0) {
    console.log(`Could not find any ${mobType} to attack.`);
    return;
  }

  // Sort entities by distance to find the nearest one
  entities.sort(
    (a, b) =>
      a.position.distanceTo(bot.entity.position) -
      b.position.distanceTo(bot.entity.position)
  );
  const nearestMob = entities[0];

  if (nearestMob) {
    try {
      bot.chat(`Attacking the nearest ${mobType}!`);
      bot.pvp.attack(nearestMob);
    } catch (error) {
      console.error(`Failed to attack the nearest ${mobType}:`, error);
    }
  } else {
    bot.chat(`No ${mobType} found nearby to attack.`);
  }
}
