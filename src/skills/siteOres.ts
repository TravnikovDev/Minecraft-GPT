// Path: src/skills/siteOres.ts
// Where its home goes, for the ore its mine will reach (owner, 2026-11-28:
// "imagine the bot started its base 5 blocks further: it would get more ore.
// The shelter should be placed so the mine's sleeves and pokeholes touch the
// most resources; from the side it should look like luck, but it must be the
// result of deep analysis").
//
// The mine is a fixed plan from the shelter's exit and direction: the
// diagonal stairs, and on each floor a room, four sleeves and their
// pokeholes. The client knows every block in the loaded chunks, ore under
// ground included, so each candidate spot and direction is scored by the ore
// blocks the plan would uncover: ore in a tunnel cell or right against one
// (a wall, floor or roof it walks past), weighted by worth.

import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import type { DirectionType } from "../actions/digging";
import { floorCells, hubStep, stepAt, dirAt, STAIR_HEADROOM } from "./mine";

// Floors counted (the mine goes down a floor every 10 blocks; ore below
// bedrock doesn't exist, so counting a few too many costs nothing)
export const SITE_LEVELS = 12;
// How far round the site it looks for ore
const ORE_LOOK = 160;
const ORE_MAX = 40_000;

/** What an ore block is worth to it (diamonds most; copper least: it has a cap). Pure. */
export function oreWorth(name: string): number {
  if (/diamond/.test(name)) return 10;
  if (/emerald/.test(name)) return 8;
  if (/gold/.test(name)) return 5;
  if (/iron/.test(name)) return 4;
  if (/lapis/.test(name)) return 3;
  if (/redstone|coal/.test(name)) return 2;
  if (/copper/.test(name)) return 1;
  return 0;
}

/** An ore block and its worth. */
export type OreAt = { x: number; y: number; z: number; worth: number };

// A cell offset from the exit as one number (each axis within +-512)
const pack = (dx: number, dy: number, dz: number): number => ((dx + 512) * 1024 + (dy + 512)) * 1024 + (dz + 512);
const SIX = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

const touchCache = new Map<string, Set<number>>();

/**
 * The cells, relative to the exit, that the mine's plan going `dir` would
 * uncover: its tunnel cells (stairs to the last floor, rooms, sleeves,
 * pokeholes) and every cell right against one. Pure (cached).
 */
export function planTouch(dir: DirectionType, levels = SITE_LEVELS): Set<number> {
  const key = `${dir}:${levels}`;
  const cached = touchCache.get(key);
  if (cached) return cached;
  const origin = new Vec3(0, 0, 0);
  const cells: Vec3[] = [];
  const last = hubStep(levels - 1);
  for (let i = 1; i <= last; i++) {
    const s = stepAt(origin, dir, i);
    for (let dy = 0; dy <= STAIR_HEADROOM; dy++) cells.push(s.offset(0, dy, 0));
  }
  for (let l = 0; l < levels; l++) cells.push(...floorCells(stepAt(origin, dir, hubStep(l)), dirAt(dir, hubStep(l)), l));
  const out = new Set<number>();
  for (const c of cells) {
    out.add(pack(c.x, c.y, c.z));
    for (const [dx, dy, dz] of SIX) out.add(pack(c.x + dx, c.y + dy, c.z + dz));
  }
  touchCache.set(key, out);
  return out;
}

/** The ore worth the mine's plan from `exit` going `dir` would uncover, of `ores`. Pure. */
export function oreValue(exit: { x: number; y: number; z: number }, dir: DirectionType, ores: OreAt[]): { worth: number; count: number } {
  const touch = planTouch(dir);
  let worth = 0;
  let count = 0;
  for (const o of ores) {
    const dx = o.x - exit.x;
    const dy = o.y - exit.y;
    const dz = o.z - exit.z;
    if (Math.abs(dx) > 511 || Math.abs(dy) > 511 || Math.abs(dz) > 511) continue;
    if (touch.has(pack(dx, dy, dz))) {
      worth += o.worth;
      count++;
    }
  }
  return { worth, count };
}

/** The ore blocks known round `center` (the loaded chunks), with their worth. */
export function oresAround(center: Vec3): OreAt[] {
  const ids = Object.values(bot.registry.blocksByName)
    .filter((b) => catalog().isOre(b.name) && oreWorth(b.name) > 0)
    .map((b) => b.id);
  const worthOf = new Map(Object.values(bot.registry.blocksByName).map((b) => [b.id, oreWorth(b.name)]));
  return bot.findBlocks({ point: center, matching: ids, maxDistance: ORE_LOOK, count: ORE_MAX }).map((p) => {
    const b = bot.blockAt(p);
    return { x: p.x, y: p.y, z: p.z, worth: b ? (worthOf.get(b.type) ?? 0) : 0 };
  });
}
