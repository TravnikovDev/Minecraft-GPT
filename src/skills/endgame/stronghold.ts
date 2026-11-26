// Path: src/skills/endgame/stronghold.ts
// The stronghold (Phase 9): an eye of ender thrown flies toward it, so two
// throws from spots far apart cross over it (geometry.triangulate). Near it
// an eye goes down instead of on. Then it digs down and looks for the
// portal room's frame (or follows the stronghold's stone bricks to it),
// fills each empty frame block with an eye, and steps into the End.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import type { Block } from "prismarine-block";
import { bot } from "../../core/body";
import { isCommandCancelled } from "../../core/commandContext";
import { equipItem, goTo, lookToward, useBlock, useHeldItem } from "../../core/primitives";
import { fail, ok, type ActionResult } from "../../core/result";
import { report } from "../../core/narrator";
import { secondThrowSpot, triangulate } from "./geometry";
import { count, endgame, goToDimension, noteEndgame, waitForDimension } from "./state";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Throw = { from: Vec3; dir: { x: number; z: number }; down: boolean };

/** Throws an eye of ender and watches it fly: where it went, and whether it went down (it's close). */
async function throwEye(): Promise<Throw | null> {
  if (count("ender_eye") === 0) return null;
  if (!(await equipItem("ender_eye")).ok) return null;
  const from = bot.entity.position.clone();
  await lookToward(bot.entity.yaw, 0.3);
  const before = new Set(Object.keys(bot.entities));
  useHeldItem();
  // Its flight: a new eye of ender entity near the bot
  let eye = null as ReturnType<typeof bot.nearestEntity>;
  for (let i = 0; i < 20 && !eye; i++) {
    await sleep(100);
    eye = bot.nearestEntity((e) => !before.has(String(e.id)) && /eye_of_ender|ender_eye/.test(e.name ?? "") && e.position.distanceTo(from) < 6);
  }
  if (!eye) return null;
  const first = eye.position.clone();
  let last = first;
  for (let i = 0; i < 15; i++) {
    await sleep(100);
    const now = bot.entities[eye.id];
    if (!now) break;
    last = now.position.clone();
  }
  // The eye drops after a moment (most of the time): pick it up again
  await sleep(2_500);
  const { pickupNearbyItems } = await import("../../actions/pickup");
  await pickupNearbyItems(bot, 16);
  const dir = { x: last.x - first.x, z: last.z - first.z };
  if (Math.hypot(dir.x, dir.z) < 0.2 && last.y >= first.y) return null; // didn't see it fly
  return { from, dir, down: last.y < first.y - 0.3 };
}

/** Finds the stronghold's place on the map: two throws that cross, then closer throws until an eye goes down. */
export async function locateStronghold(): Promise<ActionResult> {
  if (endgame().stronghold) return ok();
  const back = await goToDimension("overworld");
  if (!back.ok) return back;
  const { travelToResult } = await import("../../actions/movement");
  const first = await throwEye();
  if (!first) return fail("refused", "I couldn't see where my eye of ender flew");
  let estimate: { x: number; z: number } | null = null;
  if (first.down) estimate = { x: first.from.x, z: first.from.z };
  for (const distance of [120, 200]) {
    if (estimate || isCommandCancelled()) break;
    const spot = secondThrowSpot(first.from, first.dir, distance);
    const went = await travelToResult(() => ({ x: spot.x, y: null, z: spot.z }), { range: 8 });
    if (!went.ok) continue;
    const second = await throwEye();
    if (!second) continue;
    estimate = triangulate(first.from, first.dir, second.from, second.dir);
  }
  if (!estimate) return fail("not_found", "my eyes of ender didn't give me a crossing; I'll try from somewhere else");
  // Closer: walk there, throw again; an eye that goes down means it's right under here
  for (let i = 0; i < 4 && !isCommandCancelled(); i++) {
    const target = estimate;
    await travelToResult(() => ({ x: target.x, y: null, z: target.z }), { range: 8 });
    const near = await throwEye();
    if (!near || near.down) break;
    const n = Math.hypot(near.dir.x, near.dir.z) || 1;
    estimate = { x: near.from.x + (near.dir.x / n) * 24, z: near.from.z + (near.dir.z / n) * 24 };
  }
  const p = bot.entity.position.floored();
  await noteEndgame({ stronghold: { x: Math.round(estimate.x), y: p.y, z: Math.round(estimate.z) } });
  report(`My eyes of ender say the stronghold is under ${Math.round(estimate.x)}, ${Math.round(estimate.z)}.`);
  return ok();
}

/** End portal frame blocks in sight. */
function framesInSight(range = 48): Block[] {
  const id = bot.registry.blocksByName["end_portal_frame"]?.id;
  if (id === undefined) return [];
  return bot.findBlocks({ matching: id, maxDistance: range, count: 16 }).map((p) => bot.blockAt(p)).filter((b): b is Block => b !== null);
}

/** Digs down at the stronghold's spot and follows its stone bricks until the portal frame is in sight. */
export async function findPortalRoom(): Promise<ActionResult> {
  const e = endgame();
  if (e.endPortal) return ok();
  if (!e.stronghold) return fail("not_found", "I don't know where the stronghold is yet");
  const s = e.stronghold;
  const { tunnelTo } = await import("../../actions/digging");
  // Strongholds lie deep: down in steps, looking around at each
  for (const y of [40, 25, 10, -5, -20]) {
    if (framesInSight().length > 0 || isCommandCancelled()) break;
    if (bot.entity.position.y > y) await tunnelTo(new Vec3(s.x, y, s.z), "the stronghold");
  }
  // Its corridors: from stone bricks to stone bricks, a few hops
  const bricks = bot.registry.blocksByName["stone_bricks"]?.id;
  const visited: Vec3[] = [];
  for (let hop = 0; hop < 12 && framesInSight().length === 0 && bricks !== undefined && !isCommandCancelled(); hop++) {
    const next = bot
      .findBlocks({ matching: bricks, maxDistance: 48, count: 256 })
      .filter((p) => visited.every((v) => v.distanceTo(p) > 16))
      .sort((a, b) => b.distanceTo(bot.entity.position) - a.distanceTo(bot.entity.position))[0];
    if (!next) break;
    visited.push(next);
    await goTo(new pf.goals.GoalNear(next.x, next.y + 1, next.z, 3));
  }
  const frames = framesInSight();
  if (frames.length === 0) return fail("not_found", "no end portal frame found under the stronghold's spot");
  const c = frames.reduce((acc, f) => acc.plus(f.position), new Vec3(0, 0, 0)).scaled(1 / frames.length).floored();
  await noteEndgame({ endPortal: { x: c.x, y: frames[0]!.position.y, z: c.z } });
  report(`Found the End portal room at ${c.x}, ${frames[0]!.position.y}, ${c.z}!`);
  return ok();
}

/** Puts an eye in every empty frame block; true when the portal opened. */
export async function lightEndPortal(): Promise<ActionResult> {
  const e = endgame();
  if (!e.endPortal) return fail("not_found", "I haven't found the End portal yet");
  const c = e.endPortal;
  await goTo(new pf.goals.GoalNear(c.x, c.y, c.z, 4));
  const empty = framesInSight(12).filter((f) => f.getProperties()["eye"] !== true && f.getProperties()["eye"] !== "true");
  if (empty.length > count("ender_eye")) return fail("missing_items", `the frame needs ${empty.length} eyes and I have ${count("ender_eye")}`);
  for (const frame of empty) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    await goTo(new pf.goals.GoalNear(frame.position.x, frame.position.y, frame.position.z, 3));
    if (!(await equipItem("ender_eye")).ok) break;
    await useBlock(frame);
    await sleep(300);
  }
  await sleep(1_000);
  const portalId = bot.registry.blocksByName["end_portal"]?.id;
  const open = portalId !== undefined && bot.findBlock({ matching: portalId, maxDistance: 12 }) !== null;
  return open ? ok() : fail("refused", "the End portal didn't open (a frame block may be missing its eye)");
}

/** True when the End portal is open (or it's been to the End already). */
export function endPortalOpen(): boolean {
  if (endgame().endVisited) return true;
  const portalId = bot.registry.blocksByName["end_portal"]?.id;
  const c = endgame().endPortal;
  if (!c || portalId === undefined || !bot.entity) return false;
  if (bot.entity.position.distanceTo(new Vec3(c.x, c.y, c.z)) > 48) return false;
  return bot.findBlock({ matching: portalId, maxDistance: 48 }) !== null;
}

/**
 * Into the End, ready for it: 64 blocks to build bridges with (the spawn
 * platform is out at sea), food; then onto the portal.
 */
export async function enterEnd(): Promise<ActionResult> {
  const { acquire } = await import("../acquire");
  const { liveWorld } = await import("../world");
  if (count("cobblestone", "dirt", "cobbled_deepslate") < 64) await acquire("cobblestone", 64 - count("cobblestone"), liveWorld);
  const { foodPoints } = await import("../capabilities");
  if (foodPoints() < 30) console.log("End: going in with little food.");
  const c = endgame().endPortal;
  if (!c) return fail("not_found", "I haven't found the End portal yet");
  const portalId = bot.registry.blocksByName["end_portal"]?.id;
  const block = portalId === undefined ? null : bot.findBlock({ matching: portalId, maxDistance: 16 });
  if (!block) return fail("refused", "the End portal isn't open");
  await goTo(new pf.goals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
  if (!(await waitForDimension("the_end", 15_000))) return fail("refused", "the End portal didn't take me");
  await noteEndgame({ endVisited: endgame().endVisited ?? Date.now() });
  report("I'm in the End!");
  return ok();
}
