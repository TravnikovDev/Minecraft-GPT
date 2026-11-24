// Path: src/actions/health.ts

import { bot, listen } from "../core/body";
import { eating } from "../core/plugins";

// Fighting back is the combat reflex's job (src/actions/combatReflex.ts);
// this only makes sure the bot eats when it's hurt.
const LOW_HEALTH = 10;
const EAT_COOLDOWN_MS = 5000;
let lastEatAt = 0;

/** Eats when health drops low (auto-eat alone only reacts to hunger). */
export async function monitorHealth(): Promise<void> {
  lastEatAt = 0; // fresh state for this connection
  listen(bot, "health", () => {
    if (bot.health >= LOW_HEALTH || bot.food >= 20) return;
    if (Date.now() - lastEatAt < EAT_COOLDOWN_MS) return;
    lastEatAt = Date.now();
    void eatFood();
  });
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
