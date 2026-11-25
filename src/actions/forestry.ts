// Path: src/actions/forestry.ts
// Cutting trees like a player who keeps the forest: fell the whole trunk (a
// floating top keeps its leaves forever, so no saplings would ever drop),
// remember the stump, and about a minute later, when the leaves have fallen,
// come back, collect the saplings and plant one on each stump.
//
// The tree shape logic is pure (works on any blockAt) so it can be tested.

import { Vec3 } from "vec3";
import type { Block } from "prismarine-block";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { goTo } from "../core/primitives";
import { expectOk, wasStopped } from "../core/result";
import { markOwnWork } from "../core/commandContext";
import { asBackgroundJob, collectDrops, isIdle, mayWanderTo, noRealWork } from "./pickup";
import { placeBlock } from "./blockPlacing";
import { tellOwner } from "../managers/ownerDialog";
import { getMemory } from "../managers/persistenceManager";

type BlockAt = (pos: Vec3) => Block | null;

const MAX_TRUNK = 64; // logs in one tree (a giant jungle tree has many)
const TRUNK_RADIUS = 6; // how far a trunk spreads sideways (acacia, branches)
const SOIL = new Set(["dirt", "grass_block", "podzol", "coarse_dirt", "rooted_dirt", "mud", "moss_block", "muddy_mangrove_roots"]);
export const LEAF_DECAY_WAIT_MS = 60_000; // most leaves fall within a minute once the trunk is gone
const FORGET_AFTER_MS = 20 * 60_000; // a stump it never got back to
const REPLANT_RANGE = 48; // only goes back for stumps this close

/** The sapling a tree of this log grows from ("oak_log" -> oak_sapling), or null (nether stems). */
export function saplingFor(logName: string): string | null {
  const wood = logName.replace(/_(log|wood)$/, "");
  if (wood === "mangrove") return "mangrove_propagule";
  const sapling = `${wood}_sapling`;
  return catalog().isItem(sapling) ? sapling : null;
}

/**
 * The whole trunk the log belongs to: every log of the same kind connected
 * to it (diagonally too, for acacia and branches), bottom to top.
 */
export function findTrunk(start: Block, blockAt: BlockAt): Block[] {
  const trunk: Block[] = [];
  const seen = new Set<string>();
  const queue: Vec3[] = [start.position];
  while (queue.length > 0 && trunk.length < MAX_TRUNK) {
    const pos = queue.shift()!;
    const k = pos.toString();
    if (seen.has(k)) continue;
    seen.add(k);
    const block = blockAt(pos);
    if (!block || block.name !== start.name) continue;
    if (Math.abs(pos.x - start.position.x) > TRUNK_RADIUS || Math.abs(pos.z - start.position.z) > TRUNK_RADIUS) continue;
    trunk.push(block);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) queue.push(pos.offset(dx, dy, dz));
  }
  return trunk.sort((a, b) => a.position.y - b.position.y);
}

/**
 * A real tree has leaves around its top. Logs without any are part of
 * something built (a log cabin, a fence of logs) and are never cut.
 */
export function isNaturalTree(trunk: Block[], blockAt: BlockAt): boolean {
  if (trunk.length === 0) return false;
  const top = trunk[trunk.length - 1].position;
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -1; dy <= 2; dy++)
      for (let dz = -2; dz <= 2; dz++) {
        if (blockAt(top.offset(dx, dy, dz))?.name.endsWith("_leaves")) return true;
      }
  return false;
}

/** Where the tree stood: its lowest logs that sit on soil (four for a 2x2 tree). */
export function stumpsOf(trunk: Block[], blockAt: BlockAt): Vec3[] {
  if (trunk.length === 0) return [];
  const lowest = trunk[0].position.y;
  return trunk
    .filter((b) => b.position.y === lowest && SOIL.has(blockAt(b.position.offset(0, -1, 0))?.name ?? ""))
    .map((b) => b.position.clone());
}

/**
 * Which stumps to plant with `have` saplings. Dark oak only grows from four
 * in a square, so it's all four or none; other trees get one per stump (four
 * on a 2x2 stump grow the giant tree again), or one if there aren't enough.
 */
export function plantingSpots(stumps: Vec3[], sapling: string, have: number): Vec3[] {
  if (stumps.length === 0 || have === 0) return [];
  if (stumps.length >= 4 && have >= 4) return stumps.slice(0, 4);
  if (sapling === "dark_oak_sapling") return [];
  return stumps.slice(0, Math.min(have, stumps.length >= 4 ? 1 : stumps.length));
}

// --- Coming back to replant --------------------------------------------------

type Felled = { stumps: Vec3[]; sapling: string; at: number; nextTry: number };
const felled: Felled[] = [];

/** Remembers a tree it cut down, to replant once its leaves have fallen. */
export function rememberFelledTree(stumps: Vec3[], logName: string): void {
  const sapling = saplingFor(logName);
  if (!sapling || stumps.length === 0) return;
  felled.push({ stumps, sapling, at: Date.now(), nextTry: Date.now() + LEAF_DECAY_WAIT_MS });
}

/** How many cut trees are waiting to be replanted. */
export function treesToReplant(): number {
  return felled.length;
}

/** Plants a sapling on a stump: the spot must be free and the soil still there. */
async function plantAt(spot: Vec3, sapling: string): Promise<boolean> {
  const here = bot.blockAt(spot);
  const soil = bot.blockAt(spot.offset(0, -1, 0));
  if (!soil || !SOIL.has(soil.name)) return false;
  if (here && here.boundingBox !== "empty") return false; // something grew or was built there
  return placeBlock(sapling, spot.x, spot.y, spot.z, "bottom");
}

/** Saplings it carries, matching kind first (a stump grows back what it was, if it can). */
function saplingsCarried(prefer: string): { name: string; count: number }[] {
  const all = bot.inventory
    .items()
    .filter((i) => i.name.endsWith("_sapling") || i.name === "mangrove_propagule")
    .map((i) => ({ name: i.name, count: i.count }));
  const merged = new Map<string, number>();
  for (const s of all) merged.set(s.name, (merged.get(s.name) ?? 0) + s.count);
  return [...merged.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name === prefer ? -1 : b.name === prefer ? 1 : b.count - a.count));
}

/**
 * Plants one felled tree's stump(s): its own sapling if it has enough, else
 * any sapling it carries (a player replants with what they've got; dark oak
 * alone never grows, so that's skipped). Returns what it planted, by kind.
 */
async function replantStump(tree: Felled): Promise<string | null> {
  for (const { name, count } of saplingsCarried(tree.sapling)) {
    const spots = plantingSpots(tree.stumps, name, count);
    let planted = 0;
    for (const spot of spots) if (await plantAt(spot, name)) planted++;
    if (planted > 0) return name;
  }
  return null;
}

const RETRY_MS = 2 * 60_000; // leaves still falling: look again later

/**
 * True while it lives on its own and its first day isn't done (shelter,
 * tools, furniture, food, bed): replanting waits until then. Owner: it spent
 * the first day regrowing trees instead of getting ready for the night; it's
 * the lowest of chores.
 */
export function firstDayUnderway(): boolean {
  const memory = getMemory();
  const living = memory.autonomy?.on ?? process.env["AUTONOMY"] === "on";
  return living && !memory.milestones?.["tier1"];
}

/**
 * Called every few seconds: while idle, goes back to trees it cut a minute
 * or more ago, collects the saplings around each stump and plants them.
 * A stump it has no sapling for yet stays on the list (leaves keep falling
 * for minutes; jungle trees rarely drop one) and is tried again later.
 */
export async function replantWhenIdle(): Promise<void> {
  if (felled.length === 0 || !isIdle() || firstDayUnderway()) return;
  const now = Date.now();
  for (let i = felled.length - 1; i >= 0; i--) {
    if (now - felled[i].at <= FORGET_AFTER_MS) continue;
    const gone = felled.splice(i, 1)[0];
    console.log(`Giving up on replanting the ${gone.sapling.replace(/_sapling$/, "")} tree at ${gone.stumps[0]}: no sapling.`);
  }
  const me = bot.entity.position;
  const ready = felled.filter((t) => now >= t.nextTry && t.stumps[0].distanceTo(me) <= REPLANT_RANGE && mayWanderTo(t.stumps[0]));
  if (ready.length === 0) return;

  await asBackgroundJob("replanting", () => replant(ready));
}

async function replant(ready: Felled[]): Promise<void> {
  const stillIdle = (): boolean => {
    markOwnWork(); // its own saplings, not gifts
    return noRealWork();
  };
  const planted = new Map<string, number>();
  try {
    console.log(`Going back to replant ${ready.length} tree(s).`);
    for (const tree of ready) {
      if (!stillIdle()) break;
      const stump = tree.stumps[0];
      expectOk(await goTo(new pf.goals.GoalNear(stump.x, stump.y, stump.z, 2)));
      await collectDrops(10, { keepGoing: stillIdle });
      const used = await replantStump(tree);
      if (used) {
        planted.set(used, (planted.get(used) ?? 0) + 1);
        felled.splice(felled.indexOf(tree), 1);
      } else {
        tree.nextTry = Date.now() + RETRY_MS;
        console.log(`No sapling yet for the stump at ${stump}; I'll look again in a couple of minutes.`);
      }
    }
  } catch (error) {
    console.log(`Replanting stopped: ${(error as Error).message}`);
  } finally {
    markOwnWork();
  }
  const total = [...planted.values()].reduce((a, b) => a + b, 0);
  if (total > 0) {
    const kinds = [...planted.entries()].map(([name, n]) => `${n} ${name.replace(/_sapling$|_propagule$/, "").replace(/_/g, " ")}`).join(", ");
    tellOwner(`Replanted ${total} tree${total === 1 ? "" : "s"} (${kinds}).`);
  }
  console.log(`Replanting done: ${total} planted, ${felled.length} stump(s) still waiting for saplings.`);
}

// --- Planting on request ------------------------------------------------------------

/** Free soil around a point, two blocks apart so the trees have room. */
function plantingGround(center: Vec3, max: number): Vec3[] {
  const spots: Vec3[] = [];
  for (let r = 1; r <= 5 && spots.length < max; r++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || spots.length >= max) continue;
        for (let dy = -2; dy <= 2; dy++) {
          const p = center.offset(dx, dy, dz);
          const ok =
            SOIL.has(bot.blockAt(p.offset(0, -1, 0))?.name ?? "") &&
            bot.blockAt(p)?.boundingBox === "empty" &&
            bot.blockAt(p.offset(0, 1, 0))?.boundingBox === "empty";
          if (ok && spots.every((s) => Math.max(Math.abs(s.x - p.x), Math.abs(s.z - p.z)) >= 2)) {
            spots.push(p);
            break;
          }
        }
      }
  return spots;
}

/**
 * The owner asked to plant saplings: on the stumps of trees it cut first,
 * then on free ground around `center` (the owner, or where it stands).
 * Returns what it planted, by kind.
 */
export async function plantSaplings(center: Vec3 | null, kind: string | null, max: number): Promise<Map<string, number>> {
  const planted = new Map<string, number>();
  const add = (name: string): void => void planted.set(name, (planted.get(name) ?? 0) + 1);
  const count = (): number => [...planted.values()].reduce((a, b) => a + b, 0);
  const wanted = (name: string): boolean => !kind || name === kind || name.startsWith(kind.replace(/_sapling$/, ""));

  // Stumps of trees it cut, unless the owner said where
  if (!center) {
    for (const tree of [...felled]) {
      if (count() >= max) break;
      const s = tree.stumps[0];
      if (s.distanceTo(bot.entity.position) > REPLANT_RANGE) continue;
      const walked = await goTo(new pf.goals.GoalNear(s.x, s.y, s.z, 2));
      if (!walked.ok) {
        if (wasStopped(walked)) break;
        continue; // can't get to that stump: the next one
      }
      const used = saplingsCarried(tree.sapling).some((c) => wanted(c.name)) ? await replantStump(tree) : null;
      if (used) {
        add(used);
        felled.splice(felled.indexOf(tree), 1);
      }
    }
  }

  // Then free ground around the owner (or here)
  const around = center ?? bot.entity.position.floored();
  for (const spot of plantingGround(around, max - count())) {
    const sapling = saplingsCarried(kind ?? "").find((c) => wanted(c.name) && c.name !== "dark_oak_sapling");
    if (!sapling || count() >= max) break;
    if (await plantAt(spot, sapling.name)) add(sapling.name);
  }
  return planted;
}
