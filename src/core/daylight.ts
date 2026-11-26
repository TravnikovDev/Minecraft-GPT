// Path: src/core/daylight.ts
// The one clock for "is it day?" (review: three different answers, ticks
// 12000, 13000 and mineflayer's isDay, so fishing still thought it was day
// while the curriculum had already sent it home). Two questions, two
// answers:
// - daylight(): time for work out in the open. Day and dawn; from sunset
//   (12000) it's evening and it heads home. The Nether and the End have no
//   night.
// - mobsOut(): hostile mobs spawn in the open (13000 to 23000): the
//   reflexes and the guard watch farther then.

import { bot } from "./body";

const SUNSET = 12_000;
const DAWN = 23_000;
const MOBS_FROM = 13_000;

/** True when `t` (ticks, 0-23999) is working daylight: day or dawn. Pure. */
export const isDaylight = (t: number): boolean => t < SUNSET || t >= DAWN;

/** True when `t` (ticks) is when hostile mobs are out in the open. Pure. */
export const isMobTime = (t: number): boolean => t >= MOBS_FROM && t < DAWN;

const inOverworld = (): boolean =>
  String((bot.game as { dimension?: string } | undefined)?.dimension ?? "overworld").replace(/^minecraft:/, "") === "overworld";

/** Time for work in the open (true before the server has sent the time, and outside the overworld). */
export function daylight(): boolean {
  const t = bot.time?.timeOfDay;
  return t === undefined || !inOverworld() || isDaylight(t);
}

/** Hostile mobs are out in the open now (always, in the Nether and the End). */
export function mobsOut(): boolean {
  return !inOverworld() || isMobTime(bot.time?.timeOfDay ?? 0);
}
