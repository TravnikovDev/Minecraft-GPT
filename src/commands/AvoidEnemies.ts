// Path: src/commands/AvoidEnemies.ts

import { z } from "zod";
import { bot } from "../index";
import { goals, Movements } from "mineflayer-pathfinder";
import { Entity } from "prismarine-entity";
import { getPriorityTargets } from "../actions/combat";
import { isCommandCancelled } from "../managers/actionManager";
import vec3, { Vec3 } from "vec3";

export const description = `The user asks the bot to avoid enemies within a certain distance. The bot will move away from 
hostile mobs to maintain a safe distance. Example: "Avoid enemies within 10 blocks.", "Keep away from the zombies", "Run from creepers"`;

// Define parameters for the AvoidEnemies action
export const parameters = z.object({
  distance: z
    .number()
    .nullable()
    .describe("The distance to maintain from enemies (default 20)."),
  mobType: z
    .string()
    .nullable()
    .describe("Specific mob type to avoid (e.g., 'creeper'). If not specified, avoids all hostiles."),
  duration: z
    .number()
    .nullable()
    .describe("How long to keep avoiding enemies in seconds (default until no enemies found)."),
});

// Improve running away behavior to find safer locations
async function findSafeLocation(threateningMobs: Entity[], distance: number): Promise<Vec3> {
  // Start with current position
  let safePosition = bot.entity.position.clone();
  
  // Calculate vector away from all threatening mobs
  let awayVector = vec3(0, 0, 0);
  
  for (const mob of threateningMobs) {
    // Vector from mob to bot
    const vectorFromMob = bot.entity.position.minus(mob.position).normalize();
    
    // Weight by inverse of distance (closer mobs have more influence)
    const distanceToMob = bot.entity.position.distanceTo(mob.position);
    const weight = 1 / Math.max(0.1, distanceToMob); // Avoid division by zero
    
    // Add to total away vector, weighted by threat factor
    awayVector.add(vectorFromMob.scale(weight));
  }
  
  // If we have a direction to move
  if (awayVector.x !== 0 || awayVector.z !== 0) {
    // Normalize and scale to desired distance
    awayVector = awayVector.normalize().scale(distance);
    
    // Add to current position to get target position
    safePosition.add(awayVector);
    
    // Keep y coordinate reasonable (don't try to fly or dig too deep)
    safePosition.y = bot.entity.position.y;
  } else {
    // If no clear direction, just move randomly
    safePosition.x += Math.random() * distance * 2 - distance;
    safePosition.z += Math.random() * distance * 2 - distance;
  }
  
  return safePosition;
}

// Usage in executeAvoidEnemies function
export async function execute(args: any) {
  console.log(`Executing AvoidEnemies with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for AvoidEnemies.`);
    return;
  }

  const { mobType, duration } = parsed.data;
  const distance = parsed.data.distance ?? 20;
  const endTime = duration ? Date.now() + (duration * 1000) : null;
  
  bot.chat(`Avoiding hostile mobs by maintaining a distance of ${distance} blocks.`);
  
  let keepRunning = true;
  
  while (keepRunning) {
    if (isCommandCancelled()) {
      console.log("AvoidEnemies cancelled.");
      break;
    }

    // Check if we've reached the duration limit
    if (endTime && Date.now() > endTime) {
      keepRunning = false;
      bot.chat("Finished avoiding enemies - duration completed.");
      break;
    }
    
    // Get threatening mobs
    let threateningMobs: Entity[];
    
    if (mobType) {
      // Filter by specific mob type
      threateningMobs = Object.values(bot.entities).filter(
        entity => 
          entity.type === "mob" && 
          entity.name?.toLowerCase().includes(mobType.toLowerCase()) &&
          entity.position.distanceTo(bot.entity.position) <= distance
      );
    } else {
      // Get all hostile mobs
      threateningMobs = getPriorityTargets(distance);
    }
    
    // If no threatening mobs and not duration-based, we can stop
    if (threateningMobs.length === 0) {
      if (!endTime) {
        keepRunning = false;
        bot.chat("No more enemies nearby. Stopping avoidance behavior.");
        break;
      } else {
        // For duration-based, wait and check again
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
    }
    
    // Find a safe location to move to
    const safePosition = await findSafeLocation(threateningMobs, distance);
    
    // Move to the safe location
    bot.chat(`Moving away from ${threateningMobs.length} hostile mobs.`);
    bot.pathfinder.setMovements(new Movements(bot));
    bot.pathfinder.setGoal(new goals.GoalBlock(
      safePosition.x, 
      safePosition.y, 
      safePosition.z
    ), true);
    
    // Wait a bit before checking again
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Stop pathfinding when done
  bot.pathfinder.stop();
}
