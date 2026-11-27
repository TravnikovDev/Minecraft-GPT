// Path: src/actions/fuel.ts
// What its furnaces burn (owner, 2026-11-28: "it's fine to use planks for
// the furnace when there's a lot of wood in the inventory or the chests").
// With plenty of wood, planks go in first and the coal is kept for torches;
// otherwise coal, then charcoal, then planks and logs as before.

import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { CARRIED_LOGS, storedNear } from "./storage";

// Planks' worth of spare wood (beyond its 20-log stock) that counts as "a lot"
export const WOOD_PLENTY = 64;
// Items each fuel smelts
export const SMELTS_PER = { coal: 8, charcoal: 8, planks: 1.5, logs: 1.5 } as const;

/** Its wood, in planks: carried planks and logs, and what its chests hold. */
export type WoodCounts = { planks: number; logs: number; storedPlanks: number; storedLogs: number };

/** Planks' worth of wood beyond its carried 20-log stock (a log makes 4 planks). Pure. */
export function spareWood(c: WoodCounts): number {
  return c.planks + 4 * Math.max(0, c.logs - CARRIED_LOGS) + c.storedPlanks + 4 * c.storedLogs;
}

/** True with a lot of spare wood about (bag and chests). Pure. */
export const woodPlenty = (c: WoodCounts): boolean => spareWood(c) >= WOOD_PLENTY;

/** Fuel kinds in the order it burns them. Pure. */
export function fuelOrder(plenty: boolean): Array<keyof typeof SMELTS_PER> {
  return plenty ? ["planks", "coal", "charcoal", "logs"] : ["coal", "charcoal", "planks", "logs"];
}

/** Matches an item to a fuel kind. */
export function isFuelKind(name: string, kind: keyof typeof SMELTS_PER): boolean {
  if (kind === "planks") return catalog().isPlanks(name);
  if (kind === "logs") return catalog().isLog(name);
  return name === kind;
}

/** The live counts of its wood. */
export function woodNow(): WoodCounts {
  const items = bot.inventory.items();
  const sum = (test: (n: string) => boolean): number => items.filter((i) => test(i.name)).reduce((n, i) => n + i.count, 0);
  return {
    planks: sum((n) => catalog().isPlanks(n)),
    logs: sum((n) => catalog().isLog(n)),
    storedPlanks: storedNear("planks"),
    storedLogs: storedNear("logs"),
  };
}

/**
 * The fuel to put in for `items` smelts from what it carries, in the order
 * above (never `input` itself: logs being made into charcoal), or null.
 */
export function pickFuel(items: number, input: string | null = null): { name: string; amount: number } | null {
  const count = (name: string): number => bot.inventory.items().filter((i) => i.name === name).reduce((n, i) => n + i.count, 0);
  for (const kind of fuelOrder(woodPlenty(woodNow()))) {
    const fuel = bot.inventory.items().find((i) => isFuelKind(i.name, kind) && i.name !== input);
    if (fuel) return { name: fuel.name, amount: Math.min(count(fuel.name), Math.ceil(items / SMELTS_PER[kind])) };
  }
  return null;
}
