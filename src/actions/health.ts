// Path: src/actions/health.ts

import { bot, listen } from "../core/body";
import { defendSelf, equipBestMeleeWeapon } from "./combat";
import { eating, fighting } from "../core/plugins";

// Track previous health to detect damage
let previousHealth = 20;
let lastDamageTime = 0;
const damageThreshold = 3000; // 3 seconds cooldown between defensive reactions

// Heal if Health Drops Below Threshold and defend if under attack
export async function monitorHealth(): Promise<void> {
  // Fresh tracking for this connection (health from the old one is stale)
  previousHealth = bot.health ?? 20;
  lastDamageTime = 0;
  listen(bot, "health", () => {
    const currentHealth = bot.health;
    const now = Date.now();
    
    // Check if we've taken damage
    if (currentHealth < previousHealth) {
      const healthLost = previousHealth - currentHealth;
      
      // Significant damage taken
      if (healthLost >= 2) {
        bot.chat(`Ouch! Lost ${healthLost} health points!`);
        
        // If we haven't defended recently, start defense
        if (now - lastDamageTime > damageThreshold) {
          lastDamageTime = now;
          
          // Critical health - try to flee and heal
          if (currentHealth < 7) {
            bot.chat("Critical health! Backing away to heal!");
            emergencyRetreat();
          } 
          // Under attack - defend self
          else {
            bot.chat("Under attack! Defending myself!");
            defendFromAttack();
          }
        }
      }
      
      // Low health - start eating regardless of attack
      if (currentHealth < 10) {
        bot.chat("Health is low, eating food!");
        eatFood();
      }
    }
    
    // Update previous health
    previousHealth = currentHealth;
  });
}

// Emergency retreat when health is critically low
async function emergencyRetreat(): Promise<void> {
  try {
    // Stop any current fighting
    fighting.stop();
    
    // Try to eat food immediately
    await eatFood();
    
    // TODO: Add code to quickly run away from enemies
    // This could be done by finding the opposite direction from nearby enemies
    // or by pathfinding to a remembered safe location
  } catch (error) {
    console.error("Error during emergency retreat:", error);
  }
}

// Defend against attack
async function defendFromAttack(): Promise<void> {
  try {
    // Equip best combat gear
    await equipBestMeleeWeapon();
    
    // Activate defensive response
    await defendSelf(16);
  } catch (error) {
    console.error("Error while defending from attack:", error);
  }
}

// Eat Food to Restore Health or Hunger
async function eatFood(): Promise<void> {
  try {
    if (bot.food < 20) {
      eating.eat();
    } else {
      bot.chat("No need to eat right now.");
    }
  } catch (error) {
    console.error("Error while trying to eat food:", error);
  }
}

// Stop Eating (if needed)
export async function stopEating(): Promise<void> {
  try {
    eating.disable();
    bot.chat("Stopping eating process.");
  } catch (error) {
    console.error("Error while stopping eating:", error);
  }
}

// Resume Eating (if needed)
export async function resumeEating(): Promise<void> {
  try {
    eating.enable();
    bot.chat("Resuming automatic eating.");
  } catch (error) {
    console.error("Error while resuming eating:", error);
  }
}

// Heal by Eating
export async function heal(): Promise<void> {
  try {
    if (bot.health < 15) {
      await eatFood();
      bot.chat("Healing myself by eating food.");
    } else {
      bot.chat("Health is sufficient, no need to heal right now.");
    }
  } catch (error) {
    console.error("Error while healing:", error);
  }
}
