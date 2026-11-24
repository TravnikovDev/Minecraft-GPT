// Path: src/core/plugins.ts
// Adapters for the third-party mineflayer plugins. All plugin calls go through
// here, so a plugin can later be paused, leased to one task at a time (Phase 4)
// or swapped for another library without touching every caller. Each adapter
// tolerates the plugin not being loaded yet (before the first spawn).

import type { Block } from "prismarine-block";
import type { Entity } from "prismarine-entity";
import type { Movements, goals } from "mineflayer-pathfinder";
import { bot } from "./body";

type Goal = goals.Goal;

/** Walking and path finding (mineflayer-pathfinder). */
export const pathing = {
  /** Walks to a goal; rejects if it's unreachable, interrupted or times out. */
  goto(goal: Goal): Promise<void> {
    if (!bot.pathfinder) return Promise.reject(new Error("pathfinder is not loaded yet"));
    return bot.pathfinder.goto(goal);
  },
  /** Sets (or clears with null) the current goal without waiting for it. */
  setGoal(goal: Goal | null, dynamic = false): void {
    bot.pathfinder?.setGoal(goal, dynamic);
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
