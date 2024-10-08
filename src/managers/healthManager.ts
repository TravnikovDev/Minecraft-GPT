// Path: src/managers/healthManager.ts

import { bot } from "../index";
import { plugin as autoEat } from "mineflayer-auto-eat";

// Load Auto Eat plugin
bot.loadPlugin(autoEat);

// Configure auto-eat plugin settings
bot.autoEat({
  priority: "foodPoints", // Prioritize foods that restore the most hunger points
  startAt: 14, // Start eating when hunger is at or below this level
  bannedFood: [], // No foods are banned by default
});

// Heal if Health Drops Below Threshold
export async function monitorHealth(): Promise<void> {
  bot.on("health", () => {
    if (bot.health < 10) {
      bot.chat("My health is low, I need to heal!");
      eatFood();
    }
  });
}

// Eat Food to Restore Health or Hunger
async function eatFood(): Promise<void> {
  try {
    if (bot.food < 20) {
      bot.autoEat.eat();
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
    bot.autoEat.disable();
    bot.chat("Stopping eating process.");
  } catch (error) {
    console.error("Error while stopping eating:", error);
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
