// Path: src/skills/coalDrought.ts
// Charcoal when its mine has no coal (owner, 2026-11-28: "a fallback if the
// bot hasn't had coal for a long time: it makes charcoal, but only when it
// has a lot of logs, or a lot of trees outside"). Architect review:
// - a dry trip is one that dug its tunnels (DRY_TRIP_DUG blocks or more) and
//   broke no coal ore: an early stop, a reflex or torches made on the way
//   never count; only coal ore dug ends a drought (its own charcoal doesn't);
// - kept in world memory (a reconnect doesn't cost two more empty trips) and
//   forgotten after DROUGHT_FORGET_MS, so the mine gets another chance;
// - one decision (charcoalInstead), used by the coal milestone and by the
//   "mining ores" source the torches reach coal through.

import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { digTally } from "../core/digTally";
import { getMemory, updateMemory } from "../managers/persistenceManager";
import { woodNow, woodPlenty } from "../actions/fuel";
import { CARRIED_LOGS } from "../actions/storage";
import { workingTime } from "../core/daylight";
import { fail, ok, type ActionResult } from "../core/result";
import { chatter } from "../core/narrator";
import { shelter } from "./capabilities";

// Dry coal trips in a row that make a drought
export const DRY_TRIPS = 2;
// Blocks a trip must have dug to count (a real try at its tunnels)
export const DRY_TRIP_DUG = 60;
// A drought is forgotten after this long (the mine gets another go)
const DROUGHT_FORGET_MS = 60 * 60_000;
// Tree logs round its home that count as "a lot of trees outside"
export const TREE_LOGS_PLENTY = 40;
const TREES_LOOK = 32;

/** Whether a coal trip was dry: it dug its tunnels and broke no coal ore. Pure. */
export function tripWasDry(dug: number, coalOre: number): boolean {
  return dug >= DRY_TRIP_DUG && coalOre === 0;
}

/**
 * Charcoal instead of a mine trip for coal: a drought, and plenty of wood
 * to make it from (logs in its bag and chests beyond its stock, or trees
 * round its home). Pure.
 */
export function charcoalInstead(dryTrips: number, woodIsPlenty: boolean, treeLogs: number): boolean {
  return dryTrips >= DRY_TRIPS && (woodIsPlenty || treeLogs >= TREE_LOGS_PLENTY);
}

/** Dry coal trips in a row now (0 once forgotten). */
export function dryCoalTrips(): number {
  const d = getMemory().coalDrought;
  if (!d || Date.now() - d.since > DROUGHT_FORGET_MS) return 0;
  return d.dryTrips;
}

/** A coal trip begins: what it had dug so far, to compare with at the end. */
export function coalTripStart(): { dug: number; coalOre: number } {
  return digTally();
}

/** A coal trip ended: dry ones counted, coal ore dug ends the drought. */
export async function coalTripEnd(start: { dug: number; coalOre: number }): Promise<void> {
  const now = digTally();
  const dug = now.dug - start.dug;
  const coalOre = now.coalOre - start.coalOre;
  if (coalOre > 0) {
    if (getMemory().coalDrought) await updateMemory({ coalDrought: undefined });
    return;
  }
  if (!tripWasDry(dug, coalOre)) return;
  const before = dryCoalTrips();
  const trips = before + 1;
  // The drought dates from its first dry trip (forgotten an hour on)
  const since = before > 0 ? getMemory().coalDrought!.since : Date.now();
  await updateMemory({ coalDrought: { dryTrips: trips, since } });
  console.log(`Coal: a dry trip (${dug} blocks dug, no coal ore); ${trips} in a row.`);
}

/** Natural tree logs within TREES_LOOK of its home (what's loaded). */
function treeLogsNearHome(): number {
  const home = shelter();
  if (!home || !bot.entity) return 0;
  return bot.findBlocks({ point: new Vec3(home.x, home.y, home.z), matching: (b) => catalog().isTreeLog(b.name), maxDistance: TREES_LOOK, count: TREE_LOGS_PLENTY }).length;
}

/** The live decision: make charcoal now instead of going down its mine for coal. */
export function makeCharcoalNow(): boolean {
  const trips = dryCoalTrips();
  if (trips < DRY_TRIPS) return false;
  return charcoalInstead(trips, woodPlenty(woodNow()), treeLogsNearHome());
}

const carriedOf = (test: (name: string) => boolean): number => bot.inventory.items().filter((i) => test(i.name)).reduce((n, i) => n + i.count, 0);

/**
 * `n` charcoal from spare wood, at a furnace: logs from its chests first
 * (beyond the 20 it keeps carried: review, it would have burnt its own
 * stock), else trees in working hours. Fails at night with no spare logs at
 * hand (then a mine trip is the way: under ground the night doesn't matter).
 */
export async function makeCharcoal(n: number): Promise<ActionResult> {
  const isLog = (name: string): boolean => catalog().isLog(name);
  // A log a smelt per charcoal, and planks from a log fire six
  const want = n + Math.ceil(n / 6);
  const spare = (): number => carriedOf(isLog) - CARRIED_LOGS;
  const { storedNear, takeItems } = await import("../actions/storage");
  if (spare() < want && storedNear("logs") > 0) {
    const { makeRoom } = await import("../actions/overflow");
    await makeRoom("take logs for charcoal", ["logs"]);
    await takeItems([{ name: "logs", count: want - Math.max(0, spare()) }], true);
  }
  const { acquire } = await import("./acquire");
  const { liveWorld } = await import("./world");
  if (spare() < want) {
    if (!workingTime()) return fail("refused", "no spare logs at hand for charcoal, and trees wait for the morning");
    const got = await acquire("logs", CARRIED_LOGS + want, liveWorld);
    if (!got.ok && spare() <= 0) return got;
  }
  const before = carriedOf((name) => name === "charcoal");
  const made = await acquire("charcoal", before + Math.min(n, Math.max(1, spare())), liveWorld);
  const got = carriedOf((name) => name === "charcoal") - before;
  if (got > 0) chatter(`No coal in my mine for a while: made ${got} charcoal from spare wood.`, "coal");
  return got > 0 ? ok() : made.ok ? fail("missing_items", "no charcoal came out of the furnace") : made;
}
