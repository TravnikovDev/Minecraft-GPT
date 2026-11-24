// Path: src/core/plugins.ts
// Adapters for the third-party mineflayer plugins. All plugin calls go through
// here, so a plugin can later be paused, leased to one task at a time (Phase 4)
// or swapped for another library without touching every caller. Each adapter
// tolerates the plugin not being loaded yet (before the first spawn).

import type { Block } from "prismarine-block";
import type { Entity } from "prismarine-entity";
import type { Movements, goals } from "mineflayer-pathfinder";
import { bot } from "./body";
import { isAnyReflexActive, reflexTakeovers, waitForReflexes } from "./reflexes";
import { isTakenUrgently } from "./leases";
import { isCommandCancelled } from "./commandContext";

type Goal = goals.Goal;

// A follow goal (e.g. following the owner) paused by a reflex, resumed after it
let pausedFollow: Goal | null = null;
const MAX_REFLEX_RETRIES = 10;

/** Gets out of a boat or off an animal (walking does nothing while mounted). */
async function leaveVehicle(): Promise<void> {
  if (!bot.vehicle) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, 3000);
    function done(): void {
      clearTimeout(timer);
      bot.off("dismount", done);
      resolve();
    }
    bot.on("dismount", done);
    bot.dismount();
  });
  await new Promise((r) => setTimeout(r, 300)); // the server puts the bot down
}

/** Walking and path finding (mineflayer-pathfinder). */
export const pathing = {
  /**
   * Walks to a goal; rejects if it's unreachable, interrupted or times out.
   * A survival reflex (creeper, drowning, combat) pauses the walk instead of
   * failing it: this waits for the reflex to finish and walks on.
   */
  async goto(goal: Goal, signal?: AbortSignal): Promise<void> {
    // Stopped: the command or chore was, or the caller gave up on this walk
    const stopped = (): boolean => isCommandCancelled() || Boolean(signal?.aborted);
    for (let retry = 0; ; retry++) {
      // A stopped command must not walk on after a reflex lets go
      if (stopped()) throw new Error("Cancelled");
      await waitForReflexes(stopped);
      if (stopped()) throw new Error("Cancelled");
      if (!bot.pathfinder) throw new Error("pathfinder is not loaded yet");
      await leaveVehicle();
      const before = reflexTakeovers();
      try {
        return await bot.pathfinder.goto(goal);
      } catch (error) {
        const interrupted = isAnyReflexActive() || reflexTakeovers() !== before;
        if (!interrupted || stopped() || retry >= MAX_REFLEX_RETRIES) throw error;
      }
    }
  },
  /** Sets (or clears with null) the current goal without waiting for it. */
  setGoal(goal: Goal | null, dynamic = false): void {
    pausedFollow = null; // a new goal or a stop replaces anything paused
    bot.pathfinder?.setGoal(goal, dynamic);
  },
  /**
   * A reflex steers (running away from mobs): sets or clears its goal while
   * keeping the paused follow, which resumes when the reflex ends.
   */
  setReflexGoal(goal: Goal | null, dynamic = false): void {
    bot.pathfinder?.setGoal(goal, dynamic);
  },
  /** A reflex takes over movement; following a player resumes afterwards. */
  takeOver(): void {
    const goal = bot.pathfinder?.goal as (Goal & { entity?: { type?: string } }) | null;
    if (!pausedFollow && goal?.constructor.name === "GoalFollow" && goal.entity?.type === "player") {
      pausedFollow = goal;
    }
    bot.pathfinder?.setGoal(null);
  },
  /** Called when a reflex ends: resumes a paused follow once no reflex is left. */
  resumeAfterReflex(): void {
    if (!pausedFollow || isAnyReflexActive()) return;
    bot.pathfinder?.setGoal(pausedFollow, true);
    pausedFollow = null;
  },
  /** Gets out of a boat or off an animal before walking. */
  leaveVehicle,
  /**
   * Stops walking now. (The pathfinder's own stop() only sets a flag that the
   * next setGoal consumes, silently cancelling whatever goal comes next, so
   * it is never called.)
   */
  stop(): void {
    pausedFollow = null;
    bot.pathfinder?.setGoal(null);
  },
  /**
   * Stops walking only if `goal` is still the one being walked: a walk that
   * timed out must not clear a reflex's goal (running from mobs) or a
   * paused follow.
   */
  stopIf(goal: Goal): void {
    if (bot.pathfinder?.goal === goal) bot.pathfinder.setGoal(null);
  },
  /** Forgets a follow paused by a reflex (a new connection; its entity is gone). */
  resetPaused(): void {
    pausedFollow = null;
  },
  isMoving(): boolean {
    return bot.pathfinder?.isMoving() ?? false;
  },
  /** True while any goal is set (walking, or following someone). */
  hasGoal(): boolean {
    return Boolean(bot.pathfinder?.goal);
  },
  setMovements(movements: Movements): void {
    bot.pathfinder?.setMovements(movements);
  },
  /** Plans the current route again with the same rules (after the world changed, e.g. a door won't open). */
  replan(): void {
    const rules = bot.pathfinder?.movements;
    if (rules) bot.pathfinder.setMovements(rules);
  },
  /**
   * Runs `fn` with some walking-rule settings changed, then puts them back.
   * The rules object is shared, so this is the only way to change them for
   * one task (e.g. mining digs cheaply; plain walking prefers to go around).
   */
  async withRules<T>(
    patch: Partial<Pick<Movements, "digCost" | "placeCost" | "allowSprinting" | "allow1by1towers">>,
    fn: () => Promise<T>
  ): Promise<T> {
    const rules = bot.pathfinder?.movements as unknown as Record<string, unknown> | undefined;
    if (!rules) return fn();
    const saved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      saved[key] = rules[key];
      rules[key] = value;
    }
    try {
      return await fn();
    } finally {
      Object.assign(rules, saved);
    }
  },
  getPathTo(movements: Movements, goal: Goal, timeout?: number) {
    return bot.pathfinder.getPathTo(movements, goal, timeout);
  },
  get thinkTimeout(): number {
    return bot.pathfinder?.thinkTimeout ?? 5000;
  },
  set thinkTimeout(ms: number) {
    if (bot.pathfinder) bot.pathfinder.thinkTimeout = ms;
  },
};

/**
 * Stops everything the body is doing right now: walking, fighting, digging,
 * and any held movement keys (the owner's stop, a cancelled command).
 */
export function haltBody(options: { keepUrgent?: boolean } = {}): void {
  // With keepUrgent, what a reflex holds (running from mobs, swimming up) keeps going
  const movement = !options.keepUrgent || !isTakenUrgently("movement");
  const hands = !options.keepUrgent || !isTakenUrgently("hands");
  try {
    if (movement) {
      pathing.stop();
      bot.pvp?.forceStop();
      bot.clearControlStates();
    }
    if (hands) bot.stopDigging();
  } catch (error) {
    console.error("Error while halting the bot:", error);
  }
}

/**
 * True when nothing is using the hands on its own: not walking (the
 * pathfinder digs and places by itself) and no window open (items can't be
 * swapped in a chest). Polite borrowers (eating, armor) wait for this.
 */
export function bodyAtRest(): boolean {
  return !(bot.pathfinder?.isMoving() ?? false) && !bot.currentWindow;
}

/**
 * A reflex takes over the body: stops the task's walking (a follow resumes
 * afterwards) and any dig in progress; the task waits its turn (core/leases).
 */
export function takeOverBody(): void {
  pathing.takeOver();
  try {
    bot.stopDigging();
    // Hands can't swap items with a window open (a chest, a furnace): close it
    if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
  } catch {
    // not digging, no window
  }
}

/** Melee combat (mineflayer-pvp). */
export const fighting = {
  attack(target: Entity): Promise<void> {
    // mineflayer-pvp swaps its own walking rules in on every attack (its
    // defaults dig through walls): make it use the bot's current safe ones
    if (bot.pvp && bot.pathfinder?.movements) bot.pvp.movements = bot.pathfinder.movements;
    return Promise.resolve(bot.pvp?.attack(target));
  },
  /**
   * Stops fighting now. pvp.stop() is never used: it calls the pathfinder's
   * deferred stop (dropping the next goal, e.g. following the owner) and, when
   * nothing was walking, 5 s later clears the goal and every path_stop
   * listener. forceStop() just clears pvp's target and the goal.
   */
  stop(): void {
    bot.pvp?.forceStop();
  },
  /** The mob pvp is attacking now, if any. */
  target(): Entity | null {
    return (bot.pvp?.target as Entity | undefined) ?? null;
  },
};

/** Picking the right tool (mineflayer-tool). */
export const tools = {
  equipForBlock(block: Block): Promise<void> {
    return bot.tool ? bot.tool.equipForBlock(block) : Promise.resolve();
  },
};
