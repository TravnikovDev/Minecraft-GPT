// Path: src/core/setup.ts
// Per-connection setup of the plugins and the game-call hooks, run once when a
// connection first spawns. Kept in core/ with the other code that touches the
// mineflayer bot directly: the plugins (pathfinder, pvp, tool), one set of
// safe walking rules, and the wrappers that log every broken block and record
// scaffolding.

import type { Bot } from "mineflayer";
import { pathfinder } from "mineflayer-pathfinder";
import { plugin as pvp } from "mineflayer-pvp";
import { plugin as tool } from "mineflayer-tool";
import { everyWhileConnected } from "./body";
import { getCurrentCommandName } from "./commandContext";
import { avoidStep, isSafeMovements, walkingRules } from "./movements";
import { forgetScaffold, isPlacingOnPurpose, recordScaffold } from "./scaffold";
import { forbiddenAt, onForbiddenChange } from "./forbidden";
import { pathing } from "./plugins";

// An area marked or cleared: plan the current route again with it
onForbiddenChange(() => pathing.replan());

/** Loads the plugins and installs the walking rules and game-call hooks on a new connection. */
export function installPlugins(currentBot: Bot): void {
  currentBot.loadPlugin(pathfinder);
  currentBot.loadPlugin(pvp);
  currentBot.loadPlugin(tool);

  // One set of walking rules: natural terrain only, doors opened (core/movements).
  // mineflayer-pvp brings its own default rules (dig through anything) and
  // swaps them in on every attack, so it gets the same rules.
  // mineflayer-pvp stops itself when its target despawns (a kill) through the
  // pathfinder's deferred stop, which silently drops the next goal (the next
  // mob, or the owner to follow again) and, with nothing walking, later
  // strips every path_stop listener (the door opener's). Make its own stop
  // the immediate one.
  const pvpPlugin = currentBot.pvp as unknown as { stop: () => Promise<void>; forceStop: () => void };
  pvpPlugin.stop = async () => pvpPlugin.forceStop();

  const rules = walkingRules(currentBot);
  currentBot.pathfinder.setMovements(rules);
  // After placing a block, the pathfinder walks back to a remembered spot
  // before planning any route, and never forgets that spot (not even for a
  // new goal). With the spot gone (its scaffolding taken down) it pushed
  // forward against a wall forever: every walk "no path computed yet", the
  // bot standing idle in daylight (first game test). Off: placements are ours.
  (currentBot.pathfinder as unknown as { LOSWhenPlacingBlocks: boolean }).LOSWhenPlacingBlocks = false; // set at runtime, not in the types
  currentBot.pvp.movements = rules;

  // Backstop: if anything ever swaps in other walking rules (a plugin's
  // defaults dig through walls), say so and put the safe ones back
  everyWhileConnected(currentBot, 2000, () => {
    const current = currentBot.pathfinder?.movements;
    if (!current || isSafeMovements(current)) return;
    console.error("Walking rules were replaced by unsafe ones; restoring the safe rules.");
    currentBot.pathfinder.setMovements(rules);
    if (currentBot.pvp) currentBot.pvp.movements = rules;
  });

  // Every block the bot breaks, with what it was doing, so a broken wall can be
  // traced. This wraps bot.dig instead of listening to "diggingCompleted":
  // that event hands over the block after breaking (air), and both mineflayer
  // (on death) and the pathfinder (on every path reset, a removeAllListeners
  // call whose second argument Node ignores) strip all of its listeners.
  const dig = currentBot.dig.bind(currentBot);
  currentBot.dig = (async (block: Parameters<typeof dig>[0], ...rest: unknown[]): Promise<void> => {
    // Every dig (the pathfinder's and plugins' too) stays out of keep-out areas
    const keepOut = forbiddenAt(block.position);
    if (keepOut) throw new Error(`forbidden area: ${keepOut.reason}`);
    const what = block.name;
    const moving = currentBot.pathfinder.isMoving() ? "while walking" : "standing";
    await (dig as (...a: unknown[]) => Promise<void>)(block, ...rest);
    forgetScaffold(block.position);
    console.log(`Broke ${what} at ${block.position} (${moving}, task ${getCurrentCommandName() ?? "idle"}).`);
  }) as typeof currentBot.dig;

  // Blocks the pathfinder puts down to get somewhere (pillars up a tall tree,
  // bridges) are scaffolding the bot takes down again (core/scaffold);
  // deliberate placements (chests, torches, seeds) are marked as such
  const place = currentBot.placeBlock.bind(currentBot);
  currentBot.placeBlock = (async (reference: Parameters<typeof place>[0], face: Parameters<typeof place>[1]): Promise<void> => {
    const target = reference.position.plus(face);
    // Every placement (the pathfinder's pillars and bridges too) stays out of keep-out areas
    const keepOut = forbiddenAt(target);
    if (keepOut) throw new Error(`forbidden area: ${keepOut.reason}`);
    await place(reference, face);
    if (!isPlacingOnPurpose()) {
      // Remember what it placed, so a block someone puts there later is never taken for it
      const name = currentBot.blockAt(target)?.name ?? null;
      if (name) recordScaffold(target, name);
      console.log(`Placed scaffolding${name ? ` (${name})` : ""} at ${target} (task ${getCurrentCommandName() ?? "idle"}).`);
      // The same block put down and broken again and again: the walk is going
      // round in circles (game test: a cobblestone placed and broken at one
      // spot every 2 s for minutes, pillaring up a giant jungle tree). The
      // walk stops, and that spot is avoided for a while
      if (placedAgainAndAgain(target)) {
        console.log(`Walk going round in circles at ${target} (the same block placed again and again); stopping it.`);
        avoidStep(target);
        currentBot.pathfinder?.setGoal(null);
      }
    }
  }) as typeof currentBot.placeBlock;

  // Eating and armor are the bot's own upkeep (actions/upkeep.ts, actions/armor.ts):
  // the auto-eat and armor-manager plugins grabbed the hands whenever they liked
}

// Placements per spot, for the "round in circles" check
const placements = new Map<string, number[]>();
const CHURN_TIMES = 4;
const CHURN_WINDOW_MS = 30_000;

/** True when a block went down at `p` this many times within the window (the walk is looping). */
function placedAgainAndAgain(p: { x: number; y: number; z: number }): boolean {
  const k = `${p.x},${p.y},${p.z}`;
  const now = Date.now();
  const times = (placements.get(k) ?? []).filter((t) => now - t < CHURN_WINDOW_MS);
  times.push(now);
  placements.set(k, times);
  if (placements.size > 200) for (const [key, ts] of placements) if (now - ts[ts.length - 1]! > CHURN_WINDOW_MS) placements.delete(key);
  return times.length >= CHURN_TIMES;
}
