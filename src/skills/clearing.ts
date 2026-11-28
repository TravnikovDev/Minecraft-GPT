// Path: src/skills/clearing.ts
// The trees round its home cut down, like a player making a clearing (owner,
// 2026-11-27: in the woods, the trees round the shelter make shade where
// skeletons and zombies hide by day; and they're wood). After its stone
// tools, every natural tree within CLEAR_RADIUS of its shelter's entrance is
// felled, whole trunk, bottom up. They aren't replanted there (that would
// bring the shade back); saplings it picks up are planted elsewhere.

import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { isCommandCancelled } from "../core/commandContext";
import { forbiddenAt } from "../core/forbidden";
import { chatter } from "../core/narrator";
import { fail, ok, type ActionResult } from "../core/result";
import { fellTree, leftStanding } from "../actions/gatherWood";
import { findTrunk, isNaturalTree } from "../actions/forestry";
import { goToPosition } from "../actions/movement";
import { pickupNearbyItems } from "../actions/pickup";
import { takeDownScaffolding } from "../actions/scaffolding";
import { shelter } from "./capabilities";

// How far round its shelter's entrance the trees are cleared
export const CLEAR_RADIUS = 16;
// Trees per go (a forest is cleared over a few visits)
const TREES_PER_RUN = 25;
// Fewer logs than this left round its home: cleared (owner: "most of the
// trees"; game test, one stray log it couldn't fell brought it up out of its
// mine again and again)
export const CLEARED_BELOW = 5;

/** True when the trees round its home are cleared (a stray log or two don't count). */
export const homeCleared = (): boolean => treesNearHome().length < CLEARED_BELOW;

/** Its shelter's entrance (where the clearing is centred), or null. */
function homeCentre(): Vec3 | null {
  const start = shelter()?.details?.["start"] as { x: number; y: number; z: number } | undefined;
  return start ? new Vec3(start.x, start.y, start.z) : null;
}

/**
 * Tree logs within the clearing round its home (what's loaded), nearest the
 * bot first. Not giant 2x2 trees nor tall jungle ones: never cut (owner), so
 * they don't keep the clearing "not done".
 */
export function treesNearHome(skip: Set<string> = new Set()): Vec3[] {
  const centre = homeCentre();
  if (!centre || !bot.entity) return [];
  const at = (p: Vec3) => bot.blockAt(p);
  const standing = new Set<string>();
  const checked = new Set<string>();
  const logs = bot
    .findBlocks({ point: centre, matching: (b) => catalog().isTreeLog(b.name), maxDistance: CLEAR_RADIUS, count: 400 })
    .filter((p) => !skip.has(p.toString()) && !forbiddenAt(p));
  for (const p of logs) {
    if (checked.has(p.toString())) continue;
    const log = at(p);
    if (!log) continue;
    const trunk = findTrunk(log, at);
    const keep = leftStanding(trunk, at);
    for (const l of trunk) {
      checked.add(l.position.toString());
      if (keep) standing.add(l.position.toString());
    }
  }
  return logs.filter((p) => !standing.has(p.toString())).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
}

/** Fells the trees round its home, a run at a time. ok when none are left. */
export async function clearAroundHome(): Promise<ActionResult> {
  if (!homeCentre()) return fail("not_found", "no shelter to clear round yet");
  const skip = new Set<string>();
  let felled = 0;
  for (let n = 0; n < TREES_PER_RUN; n++) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    const next = treesNearHome(skip)[0];
    if (!next) break;
    const at = (p: Vec3) => bot.blockAt(p);
    const log = at(next);
    if (!log) break;
    const trunk = findTrunk(log, at);
    // Logs with no leaves round their top are something built: left alone
    if (!isNaturalTree(trunk, at)) {
      for (const l of trunk) skip.add(l.position.toString());
      continue;
    }
    if (!(await goToPosition(next.x, next.y, next.z, 2))) {
      for (const l of trunk) skip.add(l.position.toString());
      continue;
    }
    if (!(await fellTree(trunk))) return fail("aborted", "stopped");
    await takeDownScaffolding();
    await pickupNearbyItems(bot);
    felled++;
    // A log it couldn't break stays: never the same tree again this run
    for (const l of trunk) skip.add(l.position.toString());
  }
  if (felled > 0) chatter(`Cut down ${felled} tree${felled === 1 ? "" : "s"} round my home (no shade for mobs to hide in).`, "clearing");
  // Its logs piling up: charcoal in its home furnace for torches, and torches
  // made (owner, 2026-11-28: "after the clearing chore, if there's a lot of
  // wood, make charcoal: we need a lot of torches")
  if (felled > 0 && !isCommandCancelled()) {
    try {
      await (await import("./workshop")).workshop();
    } catch (error) {
      console.log(`Clearing: the workshop failed: ${(error as Error).message}`);
    }
  }
  const left = treesNearHome().length;
  return left < CLEARED_BELOW ? ok() : fail("not_found", `${left} logs of trees round my home still standing`);
}
