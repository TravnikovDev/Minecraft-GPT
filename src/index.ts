// Path: src/index.ts

import mineflayer from "mineflayer";
import { config } from "dotenv";
import { loadDb } from "./managers/persistenceManager";
import { executeActions } from "./managers/actionManager";
import { SERVER_HOST, SERVER_PORT } from "./config/env";
import { initiateActionFromAI } from "./managers/aiManager";
import { pathfinder } from "mineflayer-pathfinder";
import { plugin as pvp } from "mineflayer-pvp";
import { plugin as collectBlock } from "mineflayer-collectblock";
import { plugin as autoEat } from "mineflayer-auto-eat";
import { plugin as toolPlugin } from "mineflayer-tool";
import armorManager from "mineflayer-armor-manager";

// Load environment variables
config();

// Load Database before starting bot
loadDb();

// Create Bot
export const bot = mineflayer.createBot({
  host: SERVER_HOST,
  port: SERVER_PORT,
  username: process.env.BOT_USERNAME || "MinecraftGPT",
});

// Load Plugins
bot.loadPlugin(pathfinder);
bot.loadPlugin(pvp);
bot.loadPlugin(collectBlock);
bot.loadPlugin(autoEat);
bot.loadPlugin(armorManager);
bot.loadPlugin(toolPlugin);

// Event: Bot spawned
bot.once("spawn", () => {
  bot.chat("Hello world! Minecraft-gpt at your service!");
});

// Event: Player chat interaction
bot.on("chat", async (username, message) => {
  if (username === bot.username) return;

  const action = await initiateActionFromAI(username, message);
  if (action) {
    await executeActions();
  }
});

// Idle behavior: Always keep the bot busy
setInterval(async () => {
  await executeActions();
}, 5000);
