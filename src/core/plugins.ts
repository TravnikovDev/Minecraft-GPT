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

type Goal = goals.Goal;

// A follow goal (e.g. following the owner) paused by a reflex, resumed after it
let pausedFollow: Goal | null = null;
const MAX_REFLEX_RETRIES = 10;

/** Walking and path finding (mineflayer-pathfinder). */
export const pathing = {
  /**
   * Walks to a goal; rejects if it's unreachable, interrupted or times out.
   * A survival reflex (creeper, drowning, combat) pauses the walk instead of
   * failing it: this waits for the reflex to finish and walks on.
   */
  async goto(goal: Goal): Promise<void> {
    for (let retry = 0; ; retry++) {
      await waitForReflexes();
      if (!bot.pathfinder) throw new Error("pathfinder is not loaded yet");
      const before = reflexTakeovers();
      try {
        return await bot.pathfinder.goto(goal);
      } catch (error) {
        const interrupted = isAnyReflexActive() || reflexTakeovers() !== before;
        if (!interrupted || retry >= MAX_REFLEX_RETRIES) throw error;
      }
    }
  },
  /** Sets (or clears with null) the current goal without waiting for it. */
  setGoal(goal: Goal | null, dynamic = false): void {
    pausedFollow = null; // a new goal or a stop replaces anything paused
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
  /** Stops at the next safe spot. */
  stop(): void {
    bot.pathfinder?.stop();
  },
  isMoving(): boolean {
    return bot.pathfinder?.isMoving() ?? false;
  },
  setMovements(movements: Movements): void {
    bot.pathfinder?.setMovements(movements);
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

/** Melee combat (mineflayer-pvp). */
export const fighting = {
  attack(target: Entity): Promise<void> {
    return Promise.resolve(bot.pvp?.attack(target));
  },
  stop(): void {
    bot.pvp?.stop();
  },
};

/** Automatic eating (mineflayer-auto-eat v4). */
export const eating = {
  enable(): void {
    bot.autoEat?.enable();
  },
  disable(): void {
    bot.autoEat?.disable();
  },
  eat(): Promise<unknown> {
    return Promise.resolve(bot.autoEat?.eat());
  },
};

/** Picking the right tool (mineflayer-tool). */
export const tools = {
  equipForBlock(block: Block): Promise<void> {
    return bot.tool ? bot.tool.equipForBlock(block) : Promise.resolve();
  },
};
