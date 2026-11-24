// Path: src/index.ts
// Entry point: creates the Minecraft bot, wires up plugins and events,
// reconnects automatically after disconnects, and runs the command loop.

import mineflayer from "mineflayer";
import { loadDb, removeAllCommands } from "./managers/persistenceManager";
import { executeCommands, handleBotRejoin } from "./managers/actionManager";
import { AUTH, BOT_USERNAME, OWNER_USERNAME, SERVER_HOST, SERVER_PORT } from "./config/env";
import { handleChat } from "./managers/chatGateway";
import { Movements, pathfinder } from "mineflayer-pathfinder";
import { plugin as pvp } from "mineflayer-pvp";
import { plugin as autoEat } from "mineflayer-auto-eat";
import { plugin as tool } from "mineflayer-tool";
import armorManager from "mineflayer-armor-manager";
import { nightDefense } from "./actions/combat";
import { monitorHealth } from "./actions/health";
import { registerOwnerUpdates } from "./actions/ownerUpdates";

// A long-running bot must not die on one stray async error (for example a
// timer firing while disconnected); log it and keep going
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (bot keeps running):", reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception (bot keeps running):", error);
});

// Load Database before starting bot
await loadDb();

// One-off owner commands don't survive a restart: without fresh intent from
// the owner they would resume on their own. Remembered places are kept.
await removeAllCommands();

const connectionOptions = {
  host: SERVER_HOST,
  port: SERVER_PORT,
  username: BOT_USERNAME,
  auth: AUTH,
};
console.log(`Owner: ${OWNER_USERNAME} (the bot ignores everyone else's chat)`);

// Reconnect with exponential backoff: 5s, 10s, 20s, 40s, then every 60s
const RECONNECT_BASE_DELAY_MS = 5000;
const RECONNECT_MAX_DELAY_MS = 60000;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The active bot instance. It is replaced with a new instance on every
 * reconnect; modules that `import { bot }` see the new instance through
 * ES module live bindings, so always read `bot` at call time.
 */
export let bot: mineflayer.Bot = createBot();

/** Creates a bot instance and registers all event handlers on it. */
function createBot(): mineflayer.Bot {
  console.log(`Connecting to ${SERVER_HOST}:${SERVER_PORT} as ${connectionOptions.username}...`);
  const newBot = mineflayer.createBot(connectionOptions);
  // bot.chat/whisper exist only once mineflayer's plugins load (after login)
  newBot.once("login", () => throttleChat(newBot));
  registerBotEvents(newBot);
  return newBot;
}

// Servers kick players who chat faster than about one message per second
// (vanilla "disconnect.spam"; whispers count too). Every chat line and whisper
// goes through one paced queue; exact repeats within 10 s are dropped.
const CHAT_SPACING_MS = 1200;
const CHAT_REPEAT_WINDOW_MS = 10000;
const CHAT_QUEUE_LIMIT = 20;

function throttleChat(currentBot: mineflayer.Bot): void {
  const sendChat = currentBot.chat.bind(currentBot);
  const sendWhisper = currentBot.whisper.bind(currentBot);
  const queue: Array<() => void> = [];
  const recent = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const pump = (): void => {
    const next = queue.shift();
    if (!next) {
      timer = null;
      return;
    }
    try {
      next();
    } catch (error) {
      console.error("Failed to send chat:", error);
    }
    timer = setTimeout(pump, CHAT_SPACING_MS);
  };

  const enqueue = (key: string, send: () => void): void => {
    const now = Date.now();
    const last = recent.get(key);
    if (last !== undefined && now - last < CHAT_REPEAT_WINDOW_MS) return; // exact repeat
    recent.set(key, now);
    if (queue.length >= CHAT_QUEUE_LIMIT) queue.shift(); // keep the newest messages
    queue.push(send);
    if (!timer) pump();
  };

  currentBot.chat = (message: string): void => enqueue(`chat:${message}`, () => sendChat(message));
  currentBot.whisper = (username: string, message: string): void =>
    enqueue(`whisper:${username}:${message}`, () => sendWhisper(username, message));
}

/** Loads plugins and configures behavior once the bot first spawns. */
function initializeBot(currentBot: mineflayer.Bot): void {
  currentBot.loadPlugin(pathfinder);
  currentBot.loadPlugin(pvp);
  currentBot.loadPlugin(autoEat);
  currentBot.loadPlugin(tool);
  currentBot.loadPlugin(armorManager);

  const defaultMove = new Movements(currentBot);
  defaultMove.allow1by1towers = true; // Allow pillaring up with 1x1 towers
  defaultMove.canDig = true; // Allow breaking blocks when pathing
  defaultMove.canOpenDoors = true; // Enable opening doors
  defaultMove.maxDropDown = 5;
  defaultMove.digCost = 6;
  defaultMove.placeCost = 6;
  defaultMove.entityCost = 6;

  currentBot.pathfinder.setMovements(defaultMove); // Update the movement instance pathfinder uses

  // Configure auto-eat plugin settings
  currentBot.autoEat.options = {
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
  currentBot.autoEat.enable();

  // Night defense: checks for hostiles every second at night (cleared on 'end')
  nightDefense(1000);

  // Health monitoring for self-defense (listener lives on this bot instance)
  monitorHealth();

  // Personal updates to the owner (pickups, armor) and weapon-in-hand
  registerOwnerUpdates();

  console.log(`Bot spawned and initialized successfully (Minecraft ${currentBot.version})`);
}

/** Registers event handlers on one bot instance. */
function registerBotEvents(currentBot: mineflayer.Bot): void {
  currentBot.once("spawn", () => {
    reconnectAttempts = 0;
    initializeBot(currentBot);
  });

  // Fires on the first spawn and after every death/respawn
  currentBot.on("spawn", () => {
    handleBotRejoin();
  });

  currentBot.on("death", () => {
    const pos = currentBot.entity?.position;
    console.log(`Bot died${pos ? ` at ${pos.floored()}` : ""}; it will respawn automatically.`);
  });

  // Chat and whispers go through the gateway: owner only, fast path first
  currentBot.on("chat", (username, message) => {
    void handleChat(username, message);
  });
  currentBot.on("whisper", (username, message) => {
    void handleChat(username, message);
  });

  currentBot.on("playerJoined", (player: mineflayer.Player) => {
    const playerUsername = player.username;
    if (playerUsername === currentBot.username) return;
    currentBot.chat(`Hello ${playerUsername}! I am MinecraftGPT. How can I help you?`);
  });

  currentBot.on("kicked", (reason) => {
    console.error(`Bot was kicked: ${JSON.stringify(reason)}`);
  });

  // Without an 'error' listener, connection errors would crash the process
  currentBot.on("error", (error) => {
    console.error(`Bot error: ${error.message}`);
  });

  currentBot.on("end", (reason) => {
    console.log(`Bot disconnected: ${reason}`);
    scheduleReconnect();
  });
}

/** Schedules creation of a new bot instance after a backoff delay. */
function scheduleReconnect(): void {
  if (reconnectTimer) return; // A reconnect is already pending

  const delay = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts,
    RECONNECT_MAX_DELAY_MS
  );
  reconnectAttempts++;
  console.log(`Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    isProcessing = false; // A command from the old connection may never settle
    bot = createBot();
  }, delay);
}

/**
 * Disconnects and reconnects the bot with a fresh connection.
 * Resolves true once the new instance has spawned, false on timeout.
 */
export async function relogBot(reason: string, timeoutMs = 60000): Promise<boolean> {
  const oldBot = bot;
  oldBot.quit(reason); // Triggers 'end', which schedules the reconnect

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (bot !== oldBot && bot.entity) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Main loop to execute commands in queue
 */
let isProcessing = false;
setInterval(async () => {
  if (isProcessing || !bot.entity) return; // Skip while disconnected
  isProcessing = true;
  try {
    await executeCommands();
  } finally {
    isProcessing = false;
  }
}, 1500);
