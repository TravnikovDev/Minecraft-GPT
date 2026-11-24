// Path: src/index.ts
// Entry point: loads data, registers the bot's behavior on the Body (the
// connection owner in core/body.ts), connects, and runs the command loop.

import mineflayer from "mineflayer";
import { clearSolidDoors } from "./core/movements";
import { installPlugins } from "./core/setup";
import { clearScaffolds } from "./core/scaffold";
import { registerDoorOpener } from "./actions/doors";
import { autoWearArmor } from "./actions/armor";
import { tidyUpWhileIdle } from "./actions/pickup";
import { replantWhenIdle } from "./actions/forestry";
import { cleanUpScaffoldingWhenIdle } from "./actions/scaffolding";
import { bot, connect, everyWhileConnected, listen, onBotCreated, onChatSent, onConnectionEnd, onConnectionReady } from "./core/body";
import { syncRidingPosition, trackOwnerPosition } from "./managers/ownerDialog";
import { recordTurn, saveBed } from "./core/session";
import { on } from "./core/events";
import { loadDb, removeAllCommands } from "./managers/persistenceManager";
import { queueCommand } from "./managers/actionManager";
import { abortForDisconnect, handleBotRejoin } from "./managers/actionManager";
import { OWNER_USERNAME } from "./config/env";
import { handleChat, isOwner } from "./managers/chatGateway";
import { registerCombatReflex } from "./actions/combatReflex";
import { resetReflexes } from "./core/reflexes";
import { pathing } from "./core/plugins";
import { eatWhenHungry } from "./actions/upkeep";
import { registerOwnerUpdates } from "./actions/ownerUpdates";
import { registerCreeperReflex } from "./actions/creeperReflex";
import { registerDrowningReflex } from "./actions/drowningReflex";
import { checkProgress, resetStuckWatch } from "./managers/stuckWatch";
import { needsRecoveryAfterRestart, recordDeath, takeRecoveryPending } from "./actions/recovery";
import { BotCommands } from "./commands/types";

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

console.log(`Owner: ${OWNER_USERNAME} (the bot ignores everyone else's chat)`);

let restartRecoveryChecked = false;

/** Loads plugins and per-connection behavior once a connection first spawns. */
onConnectionReady((currentBot) => {
  installPlugins(currentBot); // plugins, safe walking rules, dig/place hooks, eating (core/setup)

  // Armor it carries but doesn't wear (crafted, given, or after a restart) goes on
  everyWhileConnected(currentBot, 10_000, autoWearArmor);

  // While idle, pick up items it can see lying nearby (leftover drops, saplings)
  everyWhileConnected(currentBot, 3_000, tidyUpWhileIdle);

  // A minute after cutting trees, go back for the saplings and replant them
  everyWhileConnected(currentBot, 5_000, replantWhenIdle);

  // Pillars and bridges it built to get somewhere come down again
  everyWhileConnected(currentBot, 5_000, cleanUpScaffoldingWhenIdle);

  resetReflexes(); // a new connection starts with no reflex running
  pathing.resetPaused(); // a follow paused on the old connection points at a gone entity
  onConnectionEnd(currentBot, abortForDisconnect); // a running task must not drive the next connection
  registerCombatReflex(); // fights back when mobs attack, pausing the task
  everyWhileConnected(currentBot, 2_000, eatWhenHungry); // eats between the task's actions (actions/upkeep)
  registerOwnerUpdates(); // pickup/armor whispers and weapon-in-hand
  registerCreeperReflex(); // creepers are handled on reflex, whatever the bot is doing
  registerDrowningReflex(); // and so is running out of air underwater
  registerDoorOpener(); // opens doors on the way and closes them behind
  clearSolidDoors(); // doors that wouldn't open last connection may open now
  clearScaffolds(); // scaffolding from before may have been changed since
  resetStuckWatch(); // stuck counters from an old connection don't apply
  everyWhileConnected(currentBot, 5_000, checkProgress); // nudge, replan, give up (managers/stuckWatch)

  console.log(`Bot spawned and initialized successfully (Minecraft ${currentBot.version})`);

  // Died shortly before the bot was restarted? Its items may still be there.
  if (!restartRecoveryChecked) {
    restartRecoveryChecked = true;
    if (needsRecoveryAfterRestart()) {
      console.log("Found a recent death from before the restart; recovering items.");
      void startRecovery(currentBot);
    }
  }
});

// First spawn of each connection and every respawn after death
on("bot:spawned", () => {
  handleBotRejoin();
  if (takeRecoveryPending()) void startRecovery(bot);
});

// Recent hits, so a death in the log shows what caused it
const recentDamage: string[] = [];
on("bot:damaged", ({ amount, health }) => {
  const nearest = bot.nearestEntity((e) => e.type !== "object" && e !== bot.entity && e.position.distanceTo(bot.entity.position) < 8);
  const near = nearest ? `${nearest.name ?? nearest.username ?? nearest.type} ${nearest.position.distanceTo(bot.entity.position).toFixed(1)}m away` : "nothing near";
  const block = bot.blockAt(bot.entity.position)?.name ?? "?";
  const line = `Took ${amount.toFixed(1)} damage (health ${health.toFixed(1)}) at ${bot.entity.position.floored()} in ${block}, ${near}, falling ${bot.entity.velocity.y.toFixed(2)}`;
  console.log(line);
  recentDamage.push(line);
  if (recentDamage.length > 4) recentDamage.shift();
});

on("bot:died", ({ position }) => {
  console.log(`Bot died${position ? ` at ${position.floored()}` : ""}; it will respawn automatically.`);
  if (recentDamage.length) console.log(`Last hits before death:\n  ${recentDamage.join("\n  ")}`);
  recentDamage.length = 0;
  recordDeath();
});

/** Event handlers for every new Bot instance. */
onBotCreated((currentBot) => {
  // Chat and whispers go through the gateway: owner only, fast path first
  listen(currentBot, "chat", (username: string, message: string) => handleChat(username, message));
  listen(currentBot, "whisper", (username: string, message: string) => handleChat(username, message));
  // "You have no home bed": the bot's bed was broken; forget it
  listen(currentBot, "message", (msg: { translate?: string }) => {
    if (msg.translate === "block.minecraft.spawn.not_valid") {
      console.log("The server says the bot's bed is gone; forgetting it.");
      void saveBed(null);
    }
  });
  // Keep the owner's position fresh, so "come here" works after a death or
  // restart takes the bot out of sight
  everyWhileConnected(currentBot, 20_000, trackOwnerPosition); // 3 times a minute
  everyWhileConnected(currentBot, 500, syncRidingPosition); // riding: the bot is where its boat is

  listen(currentBot, "playerJoined", (player: mineflayer.Player) => {
    if (player.username === currentBot.username) return;
    currentBot.chat(`Hello ${player.username}! I am MinecraftGPT. How can I help you?`);
  });
});

/**
 * After a death: go back for the dropped items, get basic gear if still empty
 * handed, then return to the owner if they are online. Runs ahead of anything
 * else in the queue, without asking the owner.
 */
async function startRecovery(currentBot: mineflayer.Bot): Promise<void> {
  const steps: Array<{ command: BotCommands; args: object }> = [
    { command: BotCommands.RecoverItems, args: {} },
    { command: BotCommands.StarterKit, args: {} },
  ];
  const ownerOnline = Object.keys(currentBot.players).some(
    (name) => name.toLowerCase() === OWNER_USERNAME.toLowerCase()
  );
  if (ownerOnline) {
    steps.push({ command: BotCommands.GoToPlayer, args: { player_name: OWNER_USERNAME, closeness: 3 } });
  }
  for (const step of steps) {
    queueCommand({ id: crypto.randomUUID(), priority: 0, retryCount: 0, ...step });
  }
  console.log(`Recovery queued: ${steps.map((s) => s.command).join(" -> ")}`);
}

// --- Command loop ----------------------------------------------------------

// Conversation memory: what the bot says publicly or whispers to the owner
onChatSent((text, whisperTo) => {
  console.log(`Bot says${whisperTo ? ` (to ${whisperTo})` : ""}: ${text}`);
  if (whisperTo === null || isOwner(whisperTo)) recordTurn("bot", text);
});

// No command loop: the arbiter (core/arbiter) runs tasks as they're proposed
connect();
