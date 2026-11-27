// Path: src/index.ts
// Entry point: loads data, registers the bot's behavior on the Body (the
// connection owner in core/body.ts), connects, and runs the command loop.

import mineflayer from "mineflayer";

// Every log line carries the time, so slow spots in a game test can be measured
for (const level of ["log", "error", "warn"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]): void => {
    const now = new Date();
    original(`${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, "0")}`, ...args);
  };
}
import { clearSolidDoors } from "./core/movements";
import { installPlugins } from "./core/setup";
import { clearScaffolds } from "./core/scaffold";
import { forgetServerGuesses } from "./core/forbidden";
import { registerDoorOpener } from "./actions/doors";
import { autoWearArmor } from "./actions/armor";
import { tidyUpWhileIdle } from "./actions/pickup";
import { replantWhenIdle } from "./actions/forestry";
import { cleanUpScaffoldingWhenIdle } from "./actions/scaffolding";
import "./core/narrator"; // the one chat outbox installs itself on every connection
import { bot, connect, everyWhileConnected, listen, onBotCreated, onChatSent, onConnectionEnd, onConnectionReady } from "./core/body";
import { syncRidingPosition, trackOwnerPosition } from "./managers/ownerDialog";
import { saveBed } from "./core/session";
import { on } from "./core/events";
import { removeAllCommands, useWorld, worldIdFrom } from "./managers/persistenceManager";
import { existsSync } from "node:fs";
import { queueCommand } from "./managers/actionManager";
import { abortForDisconnect, handleBotRejoin } from "./managers/actionManager";
import { OWNER_USERNAME } from "./config/env";
import { handleChat, isOwner } from "./managers/chatGateway";
import { reply } from "./core/narrator";
import { registerCombatReflex } from "./actions/combatReflex";
import { resetReflexes } from "./core/reflexes";
import { pathing } from "./core/plugins";
import { eatWhenHungry } from "./actions/upkeep";
import { lightTheWay } from "./actions/caveLighting";
import { checkPlacesNearby, resetPlaceChecks } from "./actions/placeCheck";
import { resetPerception } from "./actions/perception";
import { registerOwnerUpdates } from "./actions/ownerUpdates";
import { registerCreeperReflex } from "./actions/creeperReflex";
import { registerDrowningReflex } from "./actions/drowningReflex";
import { registerLavaReflex } from "./actions/lavaReflex";
import { registerSuffocationReflex } from "./actions/suffocationReflex";
import { checkProgress, resetStuckWatch } from "./managers/stuckWatch";
import { needsRecoveryAfterRestart, recordDeath, takeRecoveryPending } from "./actions/recovery";
import { BotCommands } from "./commands/types";
import { autonomyOn, considerNextStep, resetCurriculum } from "./skills/curriculum";
import { protectShelter, rememberShelterDoor } from "./actions/building";
import { registerFaceFix } from "./core/faces";
import { registerCreditsSkip } from "./core/primitives";
import { registerDiary } from "./planner/diaryHooks";
import { considerRole, resetRoleRest } from "./roles/runner";
import { considerOpportunities, resetOpportunities } from "./skills/opportunities";
import { considerFood, resetFoodWatch } from "./skills/foodWatch";

// A long-running bot must not die on one stray async error (for example a
// timer firing while disconnected); log it and keep going
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (bot keeps running):", reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception (bot keeps running):", error);
});

// Load Database before starting bot
// Memory is per world: it's loaded when the server says which world this is (login)
if (existsSync("db.json")) console.log("Memory: db.json is from before memory was kept per world; it isn't used (worlds/ holds each world's memory).");

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
  everyWhileConnected(currentBot, 2_500, lightTheWay); // a torch down in a dark cave as it goes (actions/caveLighting)
  resetPlaceChecks(); // check remembered places again as it comes near
  everyWhileConnected(currentBot, 10_000, checkPlacesNearby); // forget tables, chests, beds that are gone
  resetPerception(); // sightings from before may be out of date
  registerOwnerUpdates(); // pickup/armor whispers and weapon-in-hand
  registerCreeperReflex(); // creepers are handled on reflex, whatever the bot is doing
  registerDrowningReflex(); // and so is running out of air underwater
  registerLavaReflex(); // and touching lava
  registerSuffocationReflex(); // and gravel or sand fallen into its head
  registerDoorOpener(); // opens doors on the way and closes them behind
  clearSolidDoors(); // doors that wouldn't open last connection may open now
  clearScaffolds(); // scaffolding from before may have been changed since
  void forgetServerGuesses(); // "protected?" guesses from before get a fresh look
  resetStuckWatch(); // stuck counters from an old connection don't apply
  everyWhileConnected(currentBot, 5_000, checkProgress); // nudge, replan, give up (managers/stuckWatch)
  resetCurriculum(); // milestones set aside on the old connection get another chance
  everyWhileConnected(currentBot, 15_000, considerNextStep); // its own life, when the owner turned it on (skills/curriculum)
  resetRoleRest();
  everyWhileConnected(currentBot, 5_000, considerRole); // its job for the owner, a shift at a time (roles/runner)
  everyWhileConnected(currentBot, 30_000, rememberShelterDoor); // after a restart, the sealed stairs are its door again
  resetOpportunities();
  resetFoodWatch();
  registerDiary(); // the diary code writes for the day planner (Phase 7)
  // The day planner (lazy: it loads the skills): fresh guards per connection,
  // and a new plan after a death or when the plan is blocked
  void import("./planner/planner")
    .then(async ({ planDay, resetPlanner }) => {
      resetPlanner();
      const { resetRunningSteps } = await import("./planner/plan");
      await resetRunningSteps(); // nothing runs after a restart: a "running" step is to do again
      return import("./planner/runner").then(({ registerPlanRunner }) => registerPlanRunner(autonomyOn, (why) => void planDay(why)));
    })
    .catch((error: unknown) => console.error("Couldn't start the day planner:", error));
  registerCreditsSkip(); // after the End's exit portal, home without hanging on the credits
  void import("./skills/endgame/state").then((m) => m.registerPortalWatch()); // where it comes out of a portal
  registerFaceFix(); // never a hair inside a block face (the server put it back 20 times a second)
  protectShelter(); // its shelter's walls are off limits to walks and collecting from the start
  void import("./skills/mine")
    .then((m) => m.protectMine()) // and its mine stairs (lazy: skills load commands)
    .catch((error: unknown) => console.error("Couldn't protect my mine stairs:", error));
  void import("./skills/farm")
    .then((m) => m.protectFields()) // and its fields' ground
    .catch((error: unknown) => console.error("Couldn't protect my fields:", error));
  everyWhileConnected(currentBot, 5_000, considerOpportunities); // ores in sight go on the task list at their priority (skills/opportunities)
  everyWhileConnected(currentBot, 5_000, considerFood); // starving: food now; low: a restock by day (skills/foodWatch)

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
  // Which world this is: its memory is loaded before the bot spawns (and
  // switched if a respawn lands in a different world, behind a proxy)
  const loadWorld = (packet: { hashedSeed?: unknown }): void => {
    const id = worldIdFrom(packet.hashedSeed);
    if (id) void useWorld(id);
    else console.error("Memory: the server sent no world seed; memory stays as it is.");
  };
  // Ahead of mineflayer's own handlers: everything that runs at login and
  // spawn (the restart recovery check, place checks) must see this world's memory
  currentBot._client.prependListener("login", loadWorld);
  currentBot._client.prependListener("respawn", loadWorld);
  // Chat and whispers go through the gateway: owner only, fast path first
  listen(currentBot, "chat", (username: string, message: string) => handleChat(username, message, "chat"));
  listen(currentBot, "whisper", (username: string, message: string) => handleChat(username, message, "whisper"));
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

  // Say hello to the owner when they join; not to everyone already online
  // when the bot itself (re)connects (mineflayer reports them as joining too)
  const joinedAt = Date.now();
  listen(currentBot, "playerJoined", (player: mineflayer.Player) => {
    if (player.username === currentBot.username || Date.now() - joinedAt < 5_000 || !isOwner(player.username)) return;
    reply(`Hello ${player.username}! I'm here.`);
    // Living its own life: the owner is back, a good moment to (re)plan and share it
    if (autonomyOn()) void import("./planner/planner").then(({ planDay, planningOn }) => planningOn(true) && planDay("owner joined"));
  });
});

// A death this soon after the last one: the things are let go
const REPEAT_DEATH_MS = 5 * 60_000;
// Lava touched this close to the death: it died in lava (its things burned)
const LAVA_DEATH_MS = 5_000;

/**
 * After a death: go back for the dropped items, get basic gear if still empty
 * handed, then home to its chores when it has a shelter and a bed, otherwise
 * back to the owner if they are online. Runs ahead of anything
 * else in the queue, without asking the owner.
 */
async function startRecovery(currentBot: mineflayer.Bot): Promise<void> {
  // Died again within minutes of the last death (going back for its things,
  // unarmed, into the same cave at night): those things are let go, not a
  // third death (fresh-world test: two deaths in a minute in one cave)
  const { loadDeaths } = await import("./core/session");
  const deaths = loadDeaths();
  const again = deaths.length >= 2 && deaths.at(-1)!.at - deaths.at(-2)!.at < REPEAT_DEATH_MS;
  // Died in lava: its things burned there, and going back walks into it again
  const { lastTouchedLavaAt } = await import("./actions/lavaReflex");
  const lastDeathAt = deaths.at(-1)?.at ?? 0;
  const inLava = lastTouchedLavaAt() > 0 && Math.abs(lastDeathAt - lastTouchedLavaAt()) < LAVA_DEATH_MS;
  const steps: Array<{ command: BotCommands; args: object }> = again || inLava ? [] : [{ command: BotCommands.RecoverItems, args: {} }];
  if (inLava && !again) {
    const { clearLastDeath } = await import("./actions/recovery");
    clearLastDeath();
    reply("I died in lava; my things burned, so I won't go back for them.");
  }
  if (again) {
    const { clearLastDeath } = await import("./actions/recovery");
    clearLastDeath();
  }
  // Living its own life, its milestones get the gear back; otherwise a starter kit
  if (!autonomyOn()) steps.push({ command: BotCommands.StarterKit, args: {} });
  const ownerOnline = Object.keys(currentBot.players).some(
    (name) => name.toLowerCase() === OWNER_USERNAME.toLowerCase()
  );
  // A shelter and a bed of its own: home to its chores, like a player, not
  // back to the owner (owner: put goods away, cook, make pickaxes)
  const { hasHome } = await import("./commands/HomeChores");
  const home = await hasHome();
  // Said as it is: it may not have been going back for them, and with no bed
  // of its own it goes to the owner, not home (game test)
  if (again) reply(`I died again soon after the last time; I'll leave my things there and ${home ? "go home" : ownerOnline ? "come to you" : "stay safe"}.`);
  if (home) {
    steps.push({ command: BotCommands.HomeChores, args: {} });
  } else if (ownerOnline) {
    steps.push({ command: BotCommands.GoToPlayer, args: { player_name: OWNER_USERNAME, closeness: 3 } });
  }
  for (const step of steps) {
    queueCommand({ id: crypto.randomUUID(), priority: 0, retryCount: 0, ...step });
  }
  console.log(`Recovery queued: ${steps.map((s) => s.command).join(" -> ")}`);
}

// --- Command loop ----------------------------------------------------------

// Every line the bot says (the Narrator records replies and reports in the conversation)
onChatSent((text, whisperTo) => {
  console.log(`Bot says${whisperTo ? ` (to ${whisperTo})` : ""}: ${text}`);
});

// No command loop: the arbiter (core/arbiter) runs tasks as they're proposed
connect();
