// Path: src/skills/surfaceOres.ts
// Ore in the open round its home first, like a player (owner: a ravine full
// of coal, iron and copper right in front of the shelter, and it went down
// its mine instead). By day, before a mining trip, ore of the kind it's after
// that shows a face to the open sky (lit by it) within SURFACE_RANGE of the top of its
// stairs, and not far above or below it (no climbing down into deep caves),
// is taken first.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import type { Block } from "prismarine-block";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { goTo } from "../core/primitives";
import { forbiddenAt } from "../core/forbidden";
import { isCommandCancelled } from "../core/commandContext";
import { chatter } from "../core/narrator";
import { daylight } from "../core/daylight";

// How far round the top of its stairs it looks, and how far up and down
export const SURFACE_RANGE = 32;
export const SURFACE_DEPTH = 20;
// Ores it walks to before it stops looking (a vein is several blocks: each walk takes the vein)
const MAX_VEINS = 8;
// Not longer than this per trip (the milestone's mining goes on after)
const MAX_MS = 4 * 60_000;

type P3 = { x: number; y: number; z: number };

/**
 * The ore spots worth walking to: within `range` of home (horizontally) and
 * `depth` up or down, open to the air, nearest home first. Pure over its
 * inputs.
 */
export function surfaceTargets(home: P3, ores: Array<P3 & { open: boolean }>, range = SURFACE_RANGE, depth = SURFACE_DEPTH): P3[] {
  return ores
    .filter((o) => o.open && Math.abs(o.y - home.y) <= depth && Math.hypot(o.x - home.x, o.z - home.z) <= range)
    .sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z));
}

/**
 * True when the block has a face open to air the sky lights (a ravine, a
 * cliff), not water or lava. A dark cave doesn't count (owner: game test,
 * for coal "in the open" 20 blocks down in a cave, a walk dug its own way
 * there from the surface, through a pond where it nearly drowned twice, and
 * on into the cave where it died; ore underground comes from its mine).
 */
export function openToSky(at: P3, look: (p: P3) => { name: string; skyLight?: number } | null): boolean {
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
    const n = look({ x: at.x + dx, y: at.y + dy, z: at.z + dz });
    if (n && (n.name === "air" || n.name === "cave_air") && (n.skyLight ?? 0) > 0) return true;
  }
  return false;
}

/**
 * By day, ore for `item` (e.g. "raw_iron", "coal") open to the air round
 * its home: walked to and mined, up to `count` of it. How many it got.
 */
export async function surfaceOresFirst(item: string, count: number): Promise<number> {
  // By day only: from sunset on it.s evening (game test: out for coal as the night began)
  if (count <= 0 || !bot.entity || !daylight()) return 0;
  const { shelterLayout } = await import("../actions/building");
  const home = shelterLayout()?.start;
  if (!home) return 0;
  const c = catalog();
  const oreNames = c.oresFor(item);
  const ids = oreNames.map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  if (ids.length === 0) return 0;
  const homeV = new Vec3(home.x, home.y, home.z);
  const blocks = bot
    .findBlocks({ matching: ids, point: homeV, maxDistance: SURFACE_RANGE + SURFACE_DEPTH, count: 128 })
    .map((p) => bot.blockAt(p))
    .filter((b): b is Block => b !== null && !forbiddenAt(b.position));
  const targets = surfaceTargets(home, blocks.map((b) => ({ x: b.position.x, y: b.position.y, z: b.position.z, open: openToSky(b.position, (p) => bot.blockAt(new Vec3(p.x, p.y, p.z))) })));
  if (targets.length === 0) return 0;
  const { collectBlock } = await import("../actions/collectBlock");
  const have = (): number => bot.inventory.items().filter((i) => i.name === item).reduce((n, i) => n + i.count, 0);
  const start = have();
  const until = Date.now() + MAX_MS;
  chatter(`There's ${item.replace(/^raw_/, "").replace(/_/g, " ")} ore in the open by my home; taking that first.`, "surface");
  let veins = 0;
  for (const t of targets) {
    if (have() - start >= count || veins >= MAX_VEINS || Date.now() > until || isCommandCancelled()) break;
    if (!ids.includes(bot.blockAt(new Vec3(t.x, t.y, t.z))?.type ?? -1)) continue; // mined with an earlier vein
    veins++;
    const there = await goTo(new pf.goals.GoalNear(t.x, t.y, t.z, 3));
    if (!there.ok) continue;
    await collectBlock(item, count - (have() - start), 8, { seenOnly: true });
  }
  const got = have() - start;
  console.log(`Surface ore: got ${got} ${item} round my home (${veins} spots tried).`);
  if (got > 0) {
    const { takeDownScaffolding } = await import("../actions/scaffolding");
    if (!isCommandCancelled()) await takeDownScaffolding(true);
  }
  return got;
}
