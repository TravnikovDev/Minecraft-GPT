// Path: src/index.ts

import mineflayer from "mineflayer";
import { config } from "dotenv";
import { loadDb } from "./managers/persistenceManager";
import { executeCommands, handleBotRejoin } from "./managers/actionManager";
import { SERVER_HOST, SERVER_PORT } from "./config/env";
import { initiateActionFromAI } from "./managers/aiManager";
import { Movements, pathfinder } from "mineflayer-pathfinder";
import { plugin as pvp } from "mineflayer-pvp";
import { plugin as autoEat } from "mineflayer-auto-eat";
import { plugin as tool } from "mineflayer-tool";
import armorManager from "mineflayer-armor-manager";

// Load environment variables
config();

// Load Database before starting bot
loadDb();

const connectionOptions = {
  host: SERVER_HOST,
  port: SERVER_PORT,
  username: process.env["BOT_USERNAME"] || "MinecraftGPT",
};

// Create Bot
export const bot: mineflayer.Bot = mineflayer.createBot(connectionOptions);

// Event: Bot spawned
bot.once("spawn", () => {
  // Load Plugins
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);
  bot.loadPlugin(autoEat);
  bot.loadPlugin(tool);
  bot.loadPlugin(armorManager);

  const defaultMove = new Movements(bot);
  defaultMove.allow1by1towers = true; // Do not build 1x1 towers when going up
  defaultMove.canDig = true; // Disable breaking of blocks when pathing
  defaultMove.canOpenDoors = true; // Enable opening doors
  defaultMove.maxDropDown = 5;
  defaultMove.digCost = 6;
  defaultMove.placeCost = 6;
  defaultMove.entityCost = 6;

  bot.pathfinder.setMovements(defaultMove); // Update the movement instance pathfinder uses

  // Configure auto-eat plugin settings
  bot.autoEat.options = {
    priority: "foodPoints", // Prioritize foods that restore the most hunger points
    startAt: 14, // Start eating when hunger is at or below this level
    bannedFood: [], // No foods are banned by default
    healthThreshold: 10, // Start eating when health is at or below this level
    eatingTimeout: 3000, // Timeout for eating in milliseconds
    ignoreInventoryCheck: false, // Do not ignore inventory check
    checkOnItemPickup: true, // Check food on item pickup
    equipOldItem: true, // Equip old item after eating
    offhand: true, // Use offhand for food
  };
  bot.autoEat.enable();
  
  console.log("Bot spawned and initialized successfully");
  
  // Call the handler for bot rejoining - this is important for relogging scenarios
  handleBotRejoin();

  // Example commented command
  // addCommandToQueue({
  //   id: "pickup",
  //   command: BotCommands.PickupNearbyItems,
  //   priority: 4,
  // });
});

// Event: Player chat interaction
bot.on("chat", async (username, message) => {
  if (username === bot.username) return;

  await bot.pathfinder.stop();
  initiateActionFromAI(username, message);
});

bot.on("playerJoined", (player: mineflayer.Player) => {
  const playerUsername = player.username;
  if (playerUsername === bot.username) return;
  bot.chat(`Hello ${playerUsername}! I am MinecraftGPT. How can I help you?`);
  // Example commented command
  // addCommandToQueue({
  //   id: "go-to-player",
  //   command: BotCommands.GoToPlayer,
  //   priority: 7,
  //   args: { player_name: playerUsername, closeness: 5 },
  // });
});

bot.on("health", () => {
  // Example commented check
  // const existingAction = getAllCommands().find(
  //   (action) => action.id === "defend-self"
  // );
  // if (!existingAction) {
  //   addCommandToQueue({
  //     id: "defend-self",
  //     command: BotCommands.DefendSelf,
  //     priority: 9,
  //     args: { range: 8 },
  //   });
  // }
});

bot.on("breath", () => {
  bot.respawn();
});

bot.on("end", (reason) => {
  console.log(`Bot disconnected: ${reason}. Attempting to reconnect...`);
  
  // Don't exit the process if the disconnection might be part of the relogging process
  // Instead, wait briefly to see if reconnection happens via our unstuck mechanism
  setTimeout(() => {
    // If still disconnected after a timeout, then exit
    if (!bot.entity) {
      console.log("Bot failed to reconnect. Exiting...");
      process.exit(1);
    }
  }, 10000); // Wait 10 seconds before force exiting
});

// Add explicit reconnect event to handle planned relog operations
bot.on("spawn", () => {
  // This will trigger on every spawn including the first one and after relogging
  if (bot.entity) {
    // If this is a respawn after initial connection, call the rejoin handler
    handleBotRejoin();
  }
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
