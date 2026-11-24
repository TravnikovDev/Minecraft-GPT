// Path: src/actions/recovery.ts
// Recovery after death: remembers where the bot died (items stay on the ground
// for 5 minutes), and helpers for getting back on its feet afterwards.

import type { Vec3 } from "vec3";
import { bot } from "../index";

/** Dropped items despawn 5 minutes after death. */
export const ITEM_DESPAWN_MS = 5 * 60 * 1000;
/** Rough walking speed for long trips including pathing detours (blocks/s). */
const TRAVEL_SPEED = 3.5;

export interface DeathRecord {
  position: Vec3;
  dimension: string;
  at: number;
  itemCount: number;
}

let lastDeath: DeathRecord | null = null;
let recoveryPending = false;

/** Called on the 'death' event: remember where and when. */
export function recordDeath(): void {
  const pos = bot.entity?.position;
  if (!pos) return;
  lastDeath = {
    position: pos.clone(),
    dimension: String(bot.game?.dimension ?? "overworld"),
    at: Date.now(),
    itemCount: bot.inventory.items().reduce((n, item) => n + item.count, 0),
  };
  recoveryPending = true;
  console.log(`Recorded death at ${pos.floored()} with ${lastDeath.itemCount} items.`);
}

export function getLastDeath(): DeathRecord | null {
  return lastDeath;
}

export function clearLastDeath(): void {
  lastDeath = null;
}

/** True once after a death, so the respawn handler starts recovery exactly once. */
export function takeRecoveryPending(): boolean {
  const pending = recoveryPending;
  recoveryPending = false;
  return pending;
}

/** Can the bot still reach its items before they despawn? */
export function canReachBeforeDespawn(death: DeathRecord): boolean {
  if (!bot.entity) return false;
  const left = ITEM_DESPAWN_MS - (Date.now() - death.at);
  const distance = bot.entity.position.distanceTo(death.position);
  return left > 0 && distance / TRAVEL_SPEED < left / 1000;
}

/** True if the bot carries a sword or axe. */
export function hasWeapon(): boolean {
  return bot.inventory.items().some((i) => i.name.endsWith("_sword") || i.name.endsWith("_axe"));
}

/** True if the bot carries a pickaxe. */
export function hasPickaxe(): boolean {
  return bot.inventory.items().some((i) => i.name.endsWith("_pickaxe"));
}

/** Total count of edible items carried. */
export function foodCount(): number {
  const foods = bot.registry.foodsByName ?? {};
  return bot.inventory
    .items()
    .filter((i) => foods[i.name])
    .reduce((n, i) => n + i.count, 0);
}
