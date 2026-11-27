// Path: src/actions/scaffolding.ts
// Taking down the bot's own scaffolding, like a player: after chopping the
// top of a tall tree it digs its pillar away from the top while standing on
// it (nothing is left floating), then breaks the bits it can reach. Pieces
// left elsewhere are cleaned up when it's idle.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { pathing } from "../core/plugins";
import { goTo, pillarUp } from "../core/primitives";
import { wasStopped } from "../core/result";
import { isOwnScaffold, ownScaffolds, recordScaffold } from "../core/scaffold";
import { isCommandCancelled, markOwnWork } from "../core/commandContext";
import { asBackgroundJob, isIdle, mayWanderTo, noRealWork } from "./pickup";
import { breakBlockAt } from "./blockBreaking";

const REACH = 4.5;
const CLEANUP_RADIUS = 24;
const MAX_PILLAR = 64;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const eyes = (): Vec3 => bot.entity.position.offset(0, 1.62, 0);
const center = (p: { x: number; y: number; z: number }): Vec3 => new Vec3(p.x + 0.5, p.y + 0.5, p.z + 0.5);

/** Waits until it has dropped onto the block below (after digging the one it stood on). */
async function landed(fromY: number): Promise<void> {
  const until = Date.now() + 1500;
  while (Date.now() < until && !(bot.entity.onGround && bot.entity.position.y < fromY - 0.5)) await sleep(50);
}

/**
 * Standing on its own pillar: digs the block underfoot, drops onto the next,
 * and so on down to the ground. Never digs into lava or water below.
 */
async function climbDownOwnPillar(keepGoing: () => boolean): Promise<number> {
  let removed = 0;
  for (let i = 0; i < MAX_PILLAR && keepGoing(); i++) {
    const below = bot.entity.position.floored().offset(0, -1, 0);
    if (!isOwnScaffold(below)) break;
    const under = bot.blockAt(below.offset(0, -1, 0));
    if (under && (under.name === "lava" || under.name === "water")) break;
    const y = bot.entity.position.y;
    if (!(await breakBlockAt(below.x, below.y, below.z))) break;
    removed++;
    await landed(y);
  }
  return removed;
}

/** Breaks its scaffolding it can reach from where it stands, highest first (only `which`, when given). */
async function breakWithinReach(keepGoing: () => boolean, which: (p: Vec3) => boolean = () => true): Promise<number> {
  let removed = 0;
  for (const s of ownScaffolds()) {
    if (!keepGoing()) break;
    if (!which(new Vec3(s.x, s.y, s.z))) continue;
    if (eyes().distanceTo(center(s)) > REACH) continue;
    if (await breakBlockAt(s.x, s.y, s.z)) removed++;
  }
  return removed;
}

// Blocks it climbs a column of its own with (cheap ones), to reach a tall pillar's top
const CLIMB_WITH = ["dirt", "cobblestone", "cobbled_deepslate", "netherrack"];
// A pillar this many blocks over the ground it stands on is out of reach from there
const GROUND_REACH = 4;
const SIDES = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
// Walks to its scaffolding never put blocks down (game test: walking to a
// pillar placed new blocks, which were scaffolding too; it took the new ones
// down first and went round in a loop, wasting minutes)
const NO_BUILDING = { allow1by1towers: false, scafoldingBlocks: [] as number[], digCost: 100 };

/** The cells of its scaffolding in one column (x, z), highest first. Pure. */
export function columnOf(cells: Array<{ x: number; y: number; z: number }>, x: number, z: number): Array<{ x: number; y: number; z: number }> {
  return cells.filter((c) => c.x === x && c.z === z).sort((a, b) => b.y - a.y);
}

/** True when a pillar's top is out of reach from the ground at its foot. Pure. */
export function tooTallFromGround(column: Array<{ y: number }>): boolean {
  if (column.length === 0) return false;
  const foot = Math.min(...column.map((c) => c.y));
  const top = Math.max(...column.map((c) => c.y));
  return top - foot >= GROUND_REACH;
}

/**
 * A pillar of its scaffolding too tall to reach from the ground: like a
 * player, up a column of its own right beside it (recorded as scaffolding),
 * then down that column a block at a time, breaking the old pillar beside it
 * on the way; nothing is left standing. How many blocks it removed.
 */
async function takeDownTallPillar(column: Array<{ x: number; y: number; z: number }>, keepGoing: () => boolean): Promise<number> {
  const top = column[0]!;
  const foot = column[column.length - 1]!;
  const old = new Set(column.map((c) => `${c.x},${c.y},${c.z}`));
  const inOld = (p: Vec3): boolean => old.has(`${p.x},${p.y},${p.z}`);
  // A free cell beside its foot, on solid ground
  const stand = SIDES.map((d) => new Vec3(foot.x + d.x, foot.y, foot.z + d.z)).find((c) => {
    const at = (dy: number) => bot.blockAt(c.offset(0, dy, 0));
    return at(-1)?.boundingBox === "block" && at(0)?.boundingBox === "empty" && at(1)?.boundingBox === "empty";
  });
  const filler = (): string | null => CLIMB_WITH.find((n) => bot.inventory.items().some((i) => i.name === n)) ?? null;
  if (!stand || !filler()) return 0;
  const there = await pathing.withRules(NO_BUILDING, () => goTo(new pf.goals.GoalBlock(stand.x, stand.y, stand.z)));
  if (!there.ok) return 0;
  // Up its own column till the old top is within reach
  while (keepGoing() && bot.entity.position.y < top.y - 2) {
    const name = filler();
    if (!name) break;
    const feet = bot.entity.position.floored();
    if (!(await pillarUp(name)).ok) break;
    recordScaffold(feet, name);
  }
  // Down again: what of the old pillar is in reach, then the block underfoot
  let removed = 0;
  for (let i = 0; i < MAX_PILLAR && keepGoing(); i++) {
    removed += await breakWithinReach(keepGoing, inOld);
    const below = bot.entity.position.floored().offset(0, -1, 0);
    if (!isOwnScaffold(below) || inOld(below)) break;
    const y = bot.entity.position.y;
    if (!(await breakBlockAt(below.x, below.y, below.z))) break;
    removed++;
    await landed(y);
  }
  removed += await breakWithinReach(keepGoing, inOld);
  return removed;
}

/**
 * Takes down its own scaffolding around it: the pillar it stands on first,
 * then what it can reach, then (when `walk`) what it can walk up to without
 * building anything new. Returns how many blocks it removed.
 */
export async function takeDownScaffolding(walk = false, keepGoing: () => boolean = () => !isCommandCancelled()): Promise<number> {
  let removed = await climbDownOwnPillar(keepGoing);
  removed += await breakWithinReach(keepGoing);
  if (walk) {
    const me = bot.entity.position;
    const done = new Set<string>();
    for (const s of ownScaffolds().filter((p) => me.distanceTo(center(p)) <= CLEANUP_RADIUS && mayWanderTo(p))) {
      if (!keepGoing()) break;
      if (done.has(`${s.x},${s.z}`) || !isOwnScaffold(new Vec3(s.x, s.y, s.z))) continue;
      done.add(`${s.x},${s.z}`);
      // A pillar too tall to reach from the ground: up beside it and down again
      const column = columnOf(ownScaffolds(), s.x, s.z);
      if (tooTallFromGround(column)) {
        removed += await takeDownTallPillar(column, keepGoing);
        continue;
      }
      const walked = await pathing.withRules(NO_BUILDING, () => goTo(new pf.goals.GoalNear(s.x, s.y, s.z, 3)));
      if (!walked.ok) {
        if (wasStopped(walked)) break;
        continue; // out of reach from the ground (a pillar standing alone): leave it
      }
      removed += await climbDownOwnPillar(keepGoing);
      removed += await breakWithinReach(keepGoing);
    }
  }
  if (removed > 0) console.log(`Took down ${removed} block(s) of my scaffolding.`);
  return removed;
}

/** Called every few seconds: while idle, takes down scaffolding it left nearby. */
export async function cleanUpScaffoldingWhenIdle(): Promise<void> {
  if (!isIdle()) return;
  const me = bot.entity.position;
  if (!ownScaffolds().some((p) => me.distanceTo(center(p)) <= CLEANUP_RADIUS && mayWanderTo(p))) return;
  await asBackgroundJob("taking down scaffolding", async () => {
    try {
      await takeDownScaffolding(true, () => {
        markOwnWork();
        return noRealWork();
      });
    } catch (error) {
      console.log(`Taking down scaffolding stopped: ${(error as Error).message}`);
    }
  });
}
