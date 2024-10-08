// Path: src/index.ts

import mineflayer from "mineflayer";
import { config } from "dotenv";
import { addActionToQueue, loadDb } from "./managers/persistenceManager";
import { executeActions } from "./managers/actionManager";
import { SERVER_HOST, SERVER_PORT } from "./config/env";
import { initiateActionFromAI } from "./managers/aiManager";
import { Movements, pathfinder } from "mineflayer-pathfinder";
import { plugin as pvp } from "mineflayer-pvp";
import { plugin as collectBlock } from "mineflayer-collectblock";
import { plugin as autoEat } from "mineflayer-auto-eat";
import { plugin as tool } from "mineflayer-tool";
import armorManager from "mineflayer-armor-manager";
import { BotActions } from "./actions/types";

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
bot.loadPlugin(tool);
bot.loadPlugin(armorManager);

// Event: Bot spawned
bot.once("spawn", () => {
  bot.chat("Hello world! Minecraft-gpt at your service!");

  const defaultMove = new Movements(bot);

  defaultMove.allow1by1towers = false; // Do not build 1x1 towers when going up
  defaultMove.canDig = false; // Disable breaking of blocks when pathing
  bot.pathfinder.setMovements(defaultMove); // Update the movement instance pathfinder uses
});

// Event: Player chat interaction
bot.on("chat", async (username, message) => {
  if (username === bot.username) return;

  await bot.pathfinder.stop();
  initiateActionFromAI(username, message);
});

bot.on("health", () => {
  addActionToQueue({
    id: "defend-self",
    action: BotActions.DefendSelf,
    priority: 9,
    args: { range: 25 },
  });
});

bot.on("respawn", () => {
  addActionToQueue({
    id: "respawn",
    action: BotActions.GoToPlayer,
    priority: 10,
  });
});

// Idle behavior: Always keep the bot busy
setInterval(async () => {
  await executeActions();
}, 5000);
