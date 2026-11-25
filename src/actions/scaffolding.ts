// Path: src/actions/scaffolding.ts
// Taking down the bot's own scaffolding, like a player: after chopping the
// top of a tall tree it digs its pillar away from the top while standing on
// it (nothing is left floating), then breaks the bits it can reach. Pieces
// left elsewhere are cleaned up when it's idle.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { pathing } from "../core/plugins";
import { goTo } from "../core/primitives";
import { wasStopped } from "../core/result";
import { isOwnScaffold, ownScaffolds } from "../core/scaffold";
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

/** Breaks its scaffolding it can reach from where it stands, highest first. */
async function breakWithinReach(keepGoing: () => boolean): Promise<number> {
  let removed = 0;
  for (const s of ownScaffolds()) {
    if (!keepGoing()) break;
    if (eyes().distanceTo(center(s)) > REACH) continue;
    if (await breakBlockAt(s.x, s.y, s.z)) removed++;
  }
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
    for (const s of ownScaffolds().filter((p) => me.distanceTo(center(p)) <= CLEANUP_RADIUS && mayWanderTo(p))) {
      if (!keepGoing()) break;
      const walked = await pathing.withRules({ allow1by1towers: false }, () => goTo(new pf.goals.GoalNear(s.x, s.y, s.z, 3)));
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
