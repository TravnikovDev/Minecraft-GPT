// Path: src/index.ts

import mineflayer, { type Player } from "mineflayer";
import { config } from "dotenv";
import {
  addCommandToQueue,
  loadDb,
  getAllCommands,
} from "./managers/persistenceManager";
import { executeCommands } from "./managers/actionManager";
import { SERVER_HOST, SERVER_PORT } from "./config/env";
import { initiateActionFromAI } from "./managers/aiManager";
import { Movements, pathfinder } from "mineflayer-pathfinder";
import { plugin as pvp } from "mineflayer-pvp";
import { plugin as autoEat } from "mineflayer-auto-eat";
import { plugin as tool } from "mineflayer-tool";
import armorManager from "mineflayer-armor-manager";
import { BotCommands } from "./commands/types";

// Load environment variables
config();

// Load Database before starting bot
loadDb();

// Create Bot
export const bot = mineflayer.createBot({
  host: SERVER_HOST,
  port: SERVER_PORT,
  username: process.env["BOT_USERNAME"] || "MinecraftGPT",
});

// Event: Bot spawned
bot.once("spawn", () => {
  // Load Plugins
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);
  bot.loadPlugin(autoEat);
  bot.loadPlugin(tool);
  bot.loadPlugin(armorManager);

  const defaultMove = new Movements(bot);

  defaultMove.allow1by1towers = false; // Do not build 1x1 towers when going up
  defaultMove.canDig = false; // Disable breaking of blocks when pathing
  bot.pathfinder.setMovements(defaultMove); // Update the movement instance pathfinder uses

  addCommandToQueue({
    id: "pickup",
    command: BotCommands.PickupNearbyItems,
    priority: 9,
    retryCount: 1,
  });
});

// Event: Player chat interaction
bot.on("chat", async (username, message) => {
  if (username === bot.username) return;

  await bot.pathfinder.stop();
  initiateActionFromAI(username, message);
});

bot.on("playerJoined", (player: Player) => {
  const playerUsername = player.username;
  if (playerUsername === bot.username) return;
  bot.chat(`Hello ${playerUsername}! I am MinecraftGPT. How can I help you?`);
  addCommandToQueue({
    id: "go-to-player",
    command: BotCommands.GoToPlayer,
    priority: 8,
    retryCount: 1,
    args: { player_name: playerUsername, closeness: 5 },
  });
});

bot.on("health", () => {
  const existingAction = getAllCommands().find(
    (action) => action.id === "defend-self"
  );
  if (!existingAction) {
    addCommandToQueue({
      id: "defend-self",
      command: BotCommands.DefendSelf,
      priority: 9,
      args: { range: 8 },
      retryCount: 1,
    });
  }
});

bot.on("breath", () => {
  bot.respawn();
});

bot.on("end", () => {
  console.log("Bot disconnected. Reconnecting...");
  bot.end();
});

/**
 * Main loop to execute commands in queue
 */
let isProcessing = false;
setInterval(async () => {
  if (isProcessing) return;
  isProcessing = true;
  try {
    await executeCommands();
  } finally {
    isProcessing = false;
  }
}, 1500);
