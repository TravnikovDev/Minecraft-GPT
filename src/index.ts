// Path: src/index.ts

import mineflayer from "mineflayer";
import { pathfinder, goals } from "mineflayer-pathfinder";
import { plugin as pvp } from "mineflayer-pvp";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { config } from "dotenv";
import { resolve } from "path";
import { SERVER_HOST, SERVER_PORT, OPENAI_API_KEY } from "./config/env";
import OpenAI from "openai";
import { zodFunction } from "openai/helpers/zod";
import { BotActions } from "./managers/actionTypes";
import {
  GoToPlayerParameters,
  FollowPlayerParameters,
  GoToBlockParameters,
  CollectBlocksParameters,
  AttackParameters,
  DefendSelfParameters,
  AvoidEnemiesParameters,
  EquipBestWeaponParameters,
  GoToPositionParameters,
  GoToNearestBlockParameters,
  UseDoorParameters,
  GoToBedParameters,
} from "./managers/toolSchemas";
import { tools } from "./managers/toolManager";

// Load environment variables
config();

// Database Setup
interface DatabaseSchema {
  actions: { id: string; action: string; priority: number }[];
  lore: { events: any[] };
}

const dbPath = resolve("db.json");
const adapter = new JSONFile<DatabaseSchema>(dbPath);
const db = new Low(adapter, { actions: [], lore: { events: [] } });

// Load Database
async function loadDb() {
  try {
    await db.read();
    db.data ||= { actions: [], lore: { events: [] } };
    await db.write();
  } catch (error) {
    console.error("Error loading database:", error);
  }
}

// Create Bot
const bot = mineflayer.createBot({
  host: SERVER_HOST,
  port: SERVER_PORT,
  username: process.env.BOT_USERNAME || "MinecraftGPT",
});

// Load Plugins
bot.loadPlugin(pathfinder);
bot.loadPlugin(pvp);

// Initialize OpenAI Client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Load Database before starting bot
loadDb();

// Event: Bot spawned
bot.once("spawn", () => {
  bot.chat(
    "Hello! I am Minecraft-GPT, ready to assist you in the world of Minecraft!"
  );
});

// Event: Player chat interaction
bot.on("chat", async (username, message) => {
  if (username === bot.username) return;

  const openAiResponse = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content:
          "You are a helpful Minecraft assistant. Use the supplied tools to assist the user.",
      },
      { role: "user", content: message },
    ],
    tools: tools,
  });

  const response = openAiResponse.choices[0].message?.content;
  const toolCall = openAiResponse.choices[0].message?.tool_calls?.[0].function;

  if (response) bot.chat(response);
  if (toolCall) {
    const { name, arguments: toolArgs } = toolCall;
    try {
      performAction(name, JSON.parse(toolArgs));
    } catch (error) {
      bot.chat("Failed to parse arguments or perform action.");
      console.error(error);
    }
  }

  // Add command to action stack for processing
  try {
    db.data?.actions.push({
      id: String(Date.now()),
      action: response || "No response",
      priority: 3,
    });
    await db.write();
  } catch (error) {
    console.error("Error writing to database:", error);
  }
});

// Function to perform specific actions
function performAction(action: string, args: any) {
  switch (action) {
    case BotActions.GoToPlayer: {
      const { player_name, closeness } = GoToPlayerParameters.parse(args);
      const targetPlayer = bot.players[player_name]?.entity;
      if (targetPlayer) {
        bot.pathfinder.setGoal(new goals.GoalFollow(targetPlayer, closeness));
        bot.chat(
          `Heading towards ${player_name}, getting ${closeness} blocks close.`
        );
      } else {
        bot.chat(`Could not find player ${player_name}.`);
      }
      break;
    }
    case BotActions.FollowPlayer: {
      const { player_name, follow_dist } = FollowPlayerParameters.parse(args);
      const targetPlayer = bot.players[player_name]?.entity;
      if (targetPlayer) {
        bot.pathfinder.setGoal(new goals.GoalFollow(targetPlayer, follow_dist));
        bot.chat(
          `Following ${player_name} from a distance of ${follow_dist} blocks.`
        );
      } else {
        bot.chat(`Could not find player ${player_name} to follow.`);
      }
      break;
    }
    case BotActions.GoToBlock: {
      const { type, closeness, search_range } = GoToBlockParameters.parse(args);
      const block = bot.findBlock({
        matching: (block) => block.name === type,
        maxDistance: search_range,
      });
      if (block) {
        bot.pathfinder.setGoal(
          new goals.GoalBlock(
            block.position.x,
            block.position.y,
            block.position.z
          )
        );
        bot.chat(`Heading to ${type} block.`);
      } else {
        bot.chat(
          `Could not find a ${type} block within ${search_range} blocks.`
        );
      }
      break;
    }
    case BotActions.CollectBlocks: {
      const { type, num } = CollectBlocksParameters.parse(args);
      let collected = 0;
      const timeout = 30000; // 1 minute timeout
      const listener = (block: { name: any }) => {
        if (block.name === type) {
          collected++;
          bot.chat(`Collected ${collected} of ${type} blocks.`);
          if (collected >= num) {
            bot.chat(`Collected all ${num} ${type} blocks.`);
            bot.removeListener("blockBreakProgressEnd", listener);
          }
        }
      };

      bot.on("blockBreakProgressEnd", listener);

      const block = bot.findBlock({
        matching: (block) => block.name === type,
        maxDistance: 32,
      });

      if (block) {
        bot.dig(block);
      } else {
        bot.chat(`No ${type} blocks found nearby.`);
        bot.removeListener("blockBreakProgressEnd", listener);
      }

      // Set a timeout to remove the listener after a certain period
      setTimeout(() => {
        bot.removeListener("blockBreakProgressEnd", listener);
        bot.chat(`Stopped collecting ${type} blocks due to timeout.`);
      }, timeout);

      break;
    }
    case BotActions.Attack: {
      const { type } = AttackParameters.parse(args);
      const targetEntity = bot.nearestEntity(
        (entity) => entity.name === type && entity.type === "mob"
      );
      if (targetEntity) {
        bot.pvp.attack(targetEntity);
        bot.chat(`Attacking ${type}!`);
      } else {
        bot.chat(`No ${type} entities found nearby.`);
      }
      break;
    }
    default: {
      bot.chat(`Action ${action} is not recognized.`);
      break;
    }
  }
}

// Event: Entity spawning or detection
bot.on("entitySpawn", (entity) => {
  if (entity.name === "spider") {
    bot.chat("Spider detected! I am ready for battle!");
    try {
      db.data?.actions.push({
        id: String(Date.now()),
        action: BotActions.FightSpider,
        priority: 1,
      });
      db.write();
    } catch (error) {
      console.error("Error writing to database:", error);
    }
  }
});

// Idle behavior: Always keep the bot busy
setInterval(async () => {
  if (db.data?.actions.length === 0) {
    bot.chat("No tasks right now. I will gather some wood.");
    try {
      db.data?.actions.push({
        id: String(Date.now()),
        action: BotActions.GatherWood,
        priority: 5,
      });
      await db.write();
    } catch (error) {
      console.error("Error writing to database:", error);
    }
  }

  // Execute the highest priority action
  const nextAction = db.data?.actions.sort(
    (a, b) => a.priority - b.priority
  )[0];
  if (nextAction) {
    try {
      performAction(nextAction.action, {});
      db.data!.actions = db.data!.actions.filter(
        (action) => action.id !== nextAction.id
      );
      await db.write();
    } catch (error) {
      console.error("Error executing action or writing to database:", error);
    }
  }
}, 5000);
