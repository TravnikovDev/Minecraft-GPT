// Path: src/core/body.ts
// The Body: the one module that owns the live mineflayer connection.
// A new Bot instance is created on every (re)connect; everything tied to one
// connection (plugins, listeners, timers, chat pacing) is set up here and torn
// down with it. Process-lifetime state lives in the Session instead.
//
// This module deliberately imports nothing from the rest of the bot, so any
// module can import `bot` from here without creating import cycles.

import mineflayer, { type Bot } from "mineflayer";
import type { Item } from "prismarine-item";
import { AUTH, BOT_USERNAME, SERVER_HOST, SERVER_PORT } from "../config/env";
import { emit, isSelfCaused } from "./events";

/**
 * The active bot instance, replaced on every reconnect. Modules see the new
 * instance through ES module live bindings, so always read `bot` at call time.
 */
export let bot: Bot = undefined as unknown as Bot;

type BotHook = (bot: Bot) => void;
const createdHooks: BotHook[] = [];
const readyHooks: BotHook[] = [];
const reconnectHooks: Array<() => void> = [];
type ChatSentHook = (text: string, whisperTo: string | null) => void;
const chatSentHooks: ChatSentHook[] = [];

/** Runs for every chat line or whisper the bot sends (e.g. to remember the conversation). */
export function onChatSent(hook: ChatSentHook): void {
  chatSentHooks.push(hook);
}

function notifyChatSent(text: string, whisperTo: string | null): void {
  for (const hook of chatSentHooks) {
    try {
      hook(text, whisperTo);
    } catch (error) {
      console.error("Chat hook failed:", error);
    }
  }
}

/** Runs for every new Bot instance, right after it is created (register events here). */
export function onBotCreated(hook: BotHook): void {
  createdHooks.push(hook);
}

/** Runs once per connection, on its first spawn (load plugins, start reflexes here). */
export function onConnectionReady(hook: BotHook): void {
  readyHooks.push(hook);
}

/** Runs just before a replacement Bot is created after a disconnect. */
export function onBeforeReconnect(hook: () => void): void {
  reconnectHooks.push(hook);
}

// --- Safe listeners and timers ------------------------------------------

/**
 * Adds a listener that can't break the connection: errors (sync or async) are
 * logged instead of thrown, because mineflayer runs listeners inside its packet
 * handling and a throw there can stop packet processing.
 */
/** Anything with on/once: the Bot, bot.inventory, bot._client, Node emitters. */
type Listenable = {
  on: (event: any, listener: any) => unknown;
  once: (event: any, listener: any) => unknown;
};

export function listen(
  target: Listenable,
  event: string,
  handler: (...args: any[]) => unknown,
  once = false
): void {
  const guarded = (...args: unknown[]): void => {
    try {
      const result = handler(...args);
      if (result instanceof Promise) {
        result.catch((error) => console.error(`Listener for "${event}" failed:`, error));
      }
    } catch (error) {
      console.error(`Listener for "${event}" failed:`, error);
    }
  };
  if (once) target.once(event, guarded);
  else target.on(event, guarded);
}

// Cleanup to run when a connection ends: one "end" listener per connection
// instead of one per timer or reflex
const disposers = new WeakMap<Bot, Array<() => void>>();

/** Runs `dispose` once when this connection ends (stop a timer, drop a listener). */
export function onConnectionEnd(currentBot: Bot, dispose: () => void): void {
  let list = disposers.get(currentBot);
  if (!list) {
    const fresh: Array<() => void> = [];
    disposers.set(currentBot, fresh);
    currentBot.once("end", () => {
      for (const fn of fresh.splice(0)) {
        try {
          fn();
        } catch (error) {
          console.error("Connection cleanup failed:", error);
        }
      }
    });
    list = fresh;
  }
  list.push(dispose);
}

/** A repeating timer that stops automatically when this connection ends. */
export function everyWhileConnected(currentBot: Bot, ms: number, fn: () => unknown): void {
  const timer = setInterval(() => {
    try {
      const result = fn();
      if (result instanceof Promise) result.catch((error) => console.error("Timer task failed:", error));
    } catch (error) {
      console.error("Timer task failed:", error);
    }
  }, ms);
  onConnectionEnd(currentBot, () => clearInterval(timer));
}

// --- Chat pacing ----------------------------------------------------------

// Servers kick players who chat faster than about one message per second
// (vanilla "disconnect.spam"; whispers count too). Every chat line and whisper
// goes through one paced queue; exact repeats within 10 s are dropped.
const CHAT_SPACING_MS = 1200;
const CHAT_REPEAT_WINDOW_MS = 10000;
const CHAT_QUEUE_LIMIT = 20;

function throttleChat(currentBot: Bot): void {
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

  currentBot.chat = (message: string): void =>
    enqueue(`chat:${message}`, () => {
      sendChat(message);
      notifyChatSent(message, null);
    });
  currentBot.whisper = (username: string, message: string): void =>
    enqueue(`whisper:${username}:${message}`, () => {
      sendWhisper(username, message);
      notifyChatSent(message, username);
    });
  currentBot.once("end", () => {
    if (timer) clearTimeout(timer);
    queue.length = 0;
  });
}

// --- Connection lifecycle -------------------------------------------------

// Reconnect with exponential backoff: 5s, 10s, 20s, 40s, then every 60s
const RECONNECT_BASE_DELAY_MS = 5000;
const RECONNECT_MAX_DELAY_MS = 60000;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

const connectionOptions = {
  host: SERVER_HOST,
  port: SERVER_PORT,
  username: BOT_USERNAME,
  auth: AUTH,
};

/** mineflayer refuses server versions it has no data for (e.g. 26.2+ on 4.39). */
function isUnsupportedVersion(error: Error): boolean {
  return /version .* is not supported|unsupported protocol version/i.test(error.message);
}

function createBot(): Bot {
  console.log(`Connecting to ${SERVER_HOST}:${SERVER_PORT} as ${connectionOptions.username}...`);
  const newBot = mineflayer.createBot(connectionOptions);

  // bot.chat/whisper exist only once mineflayer's plugins load (after login)
  newBot.once("login", () => throttleChat(newBot));

  listen(newBot, "spawn", () => {
    reconnectAttempts = 0;
    for (const hook of readyHooks) hook(newBot);
  }, true);

  listen(newBot, "kicked", (reason) => console.error(`Bot was kicked: ${JSON.stringify(reason)}`));

  // Without an 'error' listener, connection errors would crash the process
  listen(newBot, "error", (error: Error) => {
    if (isUnsupportedVersion(error)) {
      console.error(
        `\nThis server's Minecraft version is not supported: ${error.message}\n` +
          `mineflayer 4.39 supports Minecraft up to 26.1. Open a world on 26.1 or older.\n`
      );
      stopped = true;
      process.exit(1);
    }
    console.error(`Bot error: ${error.message}`);
  });

  listen(newBot, "end", (reason) => {
    console.log(`Bot disconnected: ${reason}`);
    scheduleReconnect();
  });

  forwardEvents(newBot);
  for (const hook of createdHooks) hook(newBot);
  return newBot;
}

/** Turns this connection's raw mineflayer events into typed bus events. */
function forwardEvents(currentBot: Bot): void {
  // Unknown until the server's first health update: on login it reports the
  // health the bot had when it left, which is not damage taken now
  let lastHealth: number | null = null;
  listen(currentBot, "spawn", () => {
    lastHealth = currentBot.health ?? null;
    emit("bot:spawned", { position: currentBot.entity?.position.clone() ?? null });
  });
  listen(currentBot, "death", () => {
    emit("bot:died", { position: currentBot.entity?.position.clone() ?? null });
  });
  listen(currentBot, "health", () => {
    const health = currentBot.health;
    if (lastHealth !== null && health < lastHealth) emit("bot:damaged", { amount: lastHealth - health, health });
    lastHealth = health;
  });
  listen(currentBot, "blockUpdate", (oldBlock: { name: string } | null, newBlock: { name: string; position: any } | null) => {
    if (!newBlock || oldBlock?.name === newBlock.name) return;
    emit("block:changed", {
      position: newBlock.position,
      from: oldBlock?.name ?? "unknown",
      to: newBlock.name,
      selfCaused: isSelfCaused(newBlock.position),
    });
  });
  // An item a player throws (Q, or dragging it out of the inventory) appears
  // at their hands; a mob's drop or a broken block's drop doesn't. That's how
  // a gift is told apart from the bot's own pickups.
  const thrownBy = new WeakMap<object, string>();
  listen(currentBot, "entitySpawn", (entity: { name?: string; position: { x: number; y: number; z: number } }) => {
    if (entity.name !== "item") return;
    for (const player of Object.values(currentBot.players)) {
      const p = player.entity;
      if (!p || p === currentBot.entity) continue;
      const hands = p.position.offset(0, 1.32, 0); // eye height minus 0.3: where thrown items start
      if (hands.distanceTo(entity.position as typeof hands) <= 1) {
        thrownBy.set(entity, player.username);
        break;
      }
    }
  });
  listen(currentBot, "playerCollect", (collector: unknown, collected: { getDroppedItem?: () => Item | null }) => {
    if (collector !== currentBot.entity) return;
    const item = collected.getDroppedItem?.();
    if (item) emit("item:collected", { name: item.name, count: item.count, from: thrownBy.get(collected) ?? null });
  });
}

/** Schedules creation of a new bot instance after a backoff delay. */
function scheduleReconnect(): void {
  if (reconnectTimer || stopped) return; // A reconnect is already pending

  const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts, RECONNECT_MAX_DELAY_MS);
  reconnectAttempts++;
  console.log(`Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    for (const hook of reconnectHooks) hook();
    bot = createBot();
  }, delay);
}

/** Creates the first connection. Call once, after registering hooks. */
export function connect(): void {
  bot = createBot();
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
