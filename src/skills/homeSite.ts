// Path: src/skills/homeSite.ts
// Where to make its home, like a player who looks around before settling
// (owner, 2026-11-27: "it just built straight in the bloody cold snow
// taiga"; the 2024 site check in actions/ensureLocation was never used by
// its own life). Before its first shelter it checks the place it stands:
// - the biome: not snowy, icy, frozen, desert or ocean (beaches and
//   mountains are fine);
// - trees (about 24 logs; it replants) and animals near;
// - the way down for its mine, the diagonal to the 2nd floor (about 30
//   blocks), free of water and lava.
// Not good: it walks on, up to 500 blocks, checking as it goes, and settles
// for the best place it saw (by day; at dusk, the best one near).

import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { daylight } from "../core/daylight";
import { goTo } from "../core/primitives";
import { isCommandCancelled } from "../core/commandContext";
import { chatter, report } from "../core/narrator";
import { getAllBiomes, isHuntable } from "../utils/minecraftData";
import type { DirectionType } from "../actions/digging";
import { hubStep, stepAt } from "./mine";

// Owner's numbers
export const LOGS_WANTED = 24;
export const ANIMALS_WANTED = 3;
const LOOK = 48; // how far round it counts trees and animals
export const SEARCH_MAX = 500; // blocks it walks looking
const LEG = 48; // blocks per leg of the search
const BAD_BIOME = /snowy|ice|frozen|desert|ocean/;

/** What it found where it stands. */
export type AreaCheck = { biome: string; goodBiome: boolean; logs: number; animals: number; dryMine: boolean };

/** True for a biome it can live in (not cold, desert or sea). Pure. */
export const goodBiome = (name: string): boolean => !BAD_BIOME.test(name);

/** True when every check passes. Pure. */
export function areaGood(a: AreaCheck): boolean {
  return a.goodBiome && a.logs >= LOGS_WANTED && a.animals >= ANIMALS_WANTED && a.dryMine;
}

/** How good a place is, to keep the best seen: the biome and a dry way down first. Pure. */
export function areaScore(a: AreaCheck): number {
  return (a.goodBiome ? 100 : 0) + (a.dryMine ? 60 : 0) + Math.min(a.logs, LOGS_WANTED) + Math.min(a.animals, 6) * 4;
}

/** What's wrong with a place, for the owner. Pure. */
export function areaIssues(a: AreaCheck): string {
  const out: string[] = [];
  if (!a.goodBiome) out.push(`${a.biome.replace(/_/g, " ")} is a hard place to live`);
  if (a.logs < LOGS_WANTED) out.push(`only ${a.logs} logs near`);
  if (a.animals < ANIMALS_WANTED) out.push(`${a.animals} animals near`);
  if (!a.dryMine) out.push("water or lava on the way down for my mine");
  return out.join(", ");
}

const WET = /^(water|lava|bubble_column)$/;

/**
 * True when its mine's diagonal from `exit` going `dir`, down to the 2nd
 * floor, has no water or lava in it or beside it (what's loaded; unknown
 * blocks don't count against it).
 */
export function mineWayDry(exit: { x: number; y: number; z: number }, dir: DirectionType): boolean {
  const last = hubStep(1);
  for (let i = 1; i <= last; i++) {
    const s = stepAt(exit, dir, i);
    for (let dy = -1; dy <= 5; dy++) {
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (WET.test(bot.blockAt(s.offset(dx, dy, dz))?.name ?? "")) return false;
      }
    }
  }
  return true;
}

function biomeHere(): string {
  try {
    const id = bot.world.getBiome(bot.entity.position.floored());
    return String(getAllBiomes()[id]?.name ?? "unknown");
  } catch {
    return "unknown";
  }
}

/** Looks round where it stands. `dryMine`: whether some shelter spot here has a dry way down. */
export function checkArea(dryMine: () => boolean): AreaCheck {
  const biome = biomeHere();
  const logs = bot.findBlocks({ matching: (b) => catalog().isTreeLog(b.name), maxDistance: LOOK, count: LOGS_WANTED }).length;
  const me = bot.entity.position;
  const animals = Object.values(bot.entities).filter((e) => e !== bot.entity && e.position.distanceTo(me) <= LOOK && isHuntable(e)).length;
  return { biome, goodBiome: goodBiome(biome), logs, animals, dryMine: dryMine() };
}

const STEPS: Record<string, [number, number]> = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
const ORDER = ["n", "e", "s", "w", "ne", "se", "sw", "nw"];

/**
 * Before its first shelter: a good place for its home, here or up to 500
 * blocks on. Leaves the bot standing where it should build. `dryMine` says
 * whether a shelter spot where it stands has a dry way down for its mine.
 */
export async function findHomeArea(dryMine: () => boolean): Promise<void> {
  let here = checkArea(dryMine);
  console.log(`Home site: ${here.biome}, ${here.logs} logs, ${here.animals} animals, mine way ${here.dryMine ? "dry" : "wet"}.`);
  if (areaGood(here)) return;
  let best = { pos: bot.entity.position.clone(), check: here, score: areaScore(here) };
  report(`This isn't a good place for my home (${areaIssues(here)}); I'll look for a better one, up to ${SEARCH_MAX} blocks away.`);
  let walked = 0;
  let d = 0;
  let sinceBetter = 0;
  while (walked < SEARCH_MAX && daylight() && !isCommandCancelled()) {
    const [sx, sz] = STEPS[ORDER[d % ORDER.length]!]!;
    const from = bot.entity.position.clone();
    const to = from.offset(sx * LEG, 0, sz * LEG);
    const went = await goTo(new pf.goals.GoalNearXZ(Math.floor(to.x), Math.floor(to.z), 6));
    const moved = bot.entity.position.distanceTo(from);
    walked += moved;
    if (!went.ok && moved < 8) {
      d++; // that way's blocked (water, cliffs): another
      walked += 8; // and it counts, so a stuck search still ends
      continue;
    }
    here = checkArea(dryMine);
    const score = areaScore(here);
    console.log(`Home site at ${bot.entity.position.floored()}: ${here.biome}, ${here.logs} logs, ${here.animals} animals, mine way ${here.dryMine ? "dry" : "wet"} (score ${score}).`);
    if (score > best.score) {
      best = { pos: bot.entity.position.clone(), check: here, score };
      sinceBetter = 0;
    } else if (++sinceBetter >= 3) {
      d++; // no better this way: try another
      sinceBetter = 0;
    }
    if (areaGood(here)) {
      report(`Found a good place for my home: ${here.biome.replace(/_/g, " ")}, trees and animals near, a dry way down.`);
      return;
    }
  }
  // Not perfect anywhere it looked: the best it saw (near enough at dusk)
  const far = bot.entity.position.distanceTo(best.pos);
  if (far > 6 && (daylight() || far <= 64)) await goTo(new pf.goals.GoalNear(Math.floor(best.pos.x), Math.floor(best.pos.y), Math.floor(best.pos.z), 4));
  const settled = checkArea(dryMine);
  chatter(areaGood(settled) ? "Settling here for my home." : `Settling here for my home, the best I saw (${areaIssues(settled) || "fine"}).`, "home");
}
