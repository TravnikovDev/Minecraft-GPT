// Path: src/managers/eventHandlers.ts

import { bot } from "../index";
import {
  addAction,
  addLoreEvent,
  getAllActions,
  removeAction,
} from "./persistenceManager";
import { BotActions } from "./actionTypes";
import { goals } from "mineflayer-pathfinder";

// Register event handlers for the bot
export function registerEventHandlers() {
  // Event: Bot spawned
  bot.once("spawn", () => {
    bot.chat(
      "Hello! I am Minecraft-GPT, ready to assist you in the world of Minecraft!"
    );
  });

  // Event: Player chat interaction
  bot.on("chat", async (username, message) => {
    if (username === bot.username) return;
    // Add action to database based on chat input
    await addAction(String(Date.now()), message, 3);
  });

  // Event: Entity spawning or detection
  bot.on("entitySpawn", async (entity) => {
    if (entity.name === "spider") {
      bot.chat("Spider detected! I am ready for battle!");
      await addAction(String(Date.now()), BotActions.FightSpider, 1);
    }
  });

  // Event: Goal reached
  bot.on("goal_reached", async () => {
    bot.chat("I have reached my goal!");
  });
}

// Idle behavior: Always keep the bot busy
export async function handleIdleBehavior() {
  if (getAllActions().length === 0) {
    bot.chat("No tasks right now. I will gather some wood.");
    await addAction(String(Date.now()), BotActions.GatherWood, 5);
  }
}

// Execute the highest priority action
export async function executeNextAction() {
  const actions = getAllActions().sort((a, b) => a.priority - b.priority);
  const nextAction = actions[0];
  if (nextAction) {
    try {
      performAction(nextAction.action);
      await removeAction(nextAction.id);
    } catch (error) {
      console.error("Error executing action:", error);
    }
  }
}

// Function to perform specific actions
function performAction(action: string) {
  switch (action) {
    case BotActions.FightSpider: {
      const spider = bot.nearestEntity(
        (entity) => entity.name === "spider" && entity.type === "mob"
      );
      if (spider) {
        bot.chat("Engaging in combat!");
        bot.pvp.attack(spider);
      } else {
        bot.chat("No spider found to attack.");
      }
      break;
    }
    case BotActions.GatherWood: {
      bot.chat("Heading out to gather wood.");
      const woodBlock = bot.findBlock({
        matching: (block) => block.name.includes("log"),
        maxDistance: 32,
      });
      if (woodBlock) {
        bot.pathfinder.setGoal(
          new goals.GoalBlock(
            woodBlock.position.x,
            woodBlock.position.y,
            woodBlock.position.z
          )
        );
        bot.once("goal_reached", () => {
          bot.dig(woodBlock);
        });
      } else {
        bot.chat("No wood blocks found nearby.");
      }
      break;
    }
    default: {
      bot.chat(`Action ${action} is not recognized.`);
      break;
    }
  }
}

// Periodic check for idle behavior
setInterval(async () => {
  await handleIdleBehavior();
  await executeNextAction();
}, 5000);
