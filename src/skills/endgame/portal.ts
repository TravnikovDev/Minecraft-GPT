// Path: src/skills/endgame/portal.ts
// The Nether portal (Phase 9): 10 obsidian in a frame, lit with flint and
// steel. Obsidian is mined with a diamond pickaxe: obsidian it can see (a
// ruined portal, a cave where lava met water), or made first from a lava
// pool, the way a player does it: water poured on the shore beside the
// lava flows over it and turns its surface to obsidian; the water is taken
// back up. (Casting each frame block from lava buckets is left out: done
// wrong it floods the base with lava.)

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import type { Block } from "prismarine-block";
import { bot } from "../../core/body";
import { isCommandCancelled } from "../../core/commandContext";
import { equipItem, goTo, useBlock, useHeldItemToward } from "../../core/primitives";
import { describeFailure, fail, ok, type ActionResult } from "../../core/result";
import { report } from "../../core/narrator";
import { portalFrame, type Axis, type P3 } from "./geometry";
import { count, endgame, noteEndgame } from "./state";

const OBSIDIAN = 10;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const v = (p: P3): Vec3 => new Vec3(p.x, p.y, p.z);
const isAirish = (b: Block | null): boolean => b !== null && (b.boundingBox === "empty" && b.name !== "water" && b.name !== "lava");
const isSolid = (b: Block | null): boolean => b !== null && b.boundingBox === "block";

/** True when its portal in the overworld stands (or is out of view: then trusted). */
export function portalStands(): boolean {
  const p = endgame().overworldPortal;
  if (!p) return false;
  const b = bot.blockAt(v(p));
  return b === null || b.name === "nether_portal";
}

/** Fills its empty bucket from a water source in sight. */
async function fillWater(): Promise<ActionResult> {
  if (count("water_bucket") > 0) return ok();
  if (count("bucket") === 0) return fail("missing_items", "I have no bucket");
  const id = bot.registry.blocksByName["water"]?.id;
  const spots = id === undefined ? [] : bot.findBlocks({ matching: id, maxDistance: 48, count: 64 });
  const source = spots.map((p) => bot.blockAt(p)).find((b) => b && Number(b.getProperties()["level"] ?? 0) === 0);
  if (!source) return fail("not_found", "I see no water to fill my bucket with");
  await goTo(new pf.goals.GoalNear(source.position.x, source.position.y, source.position.z, 2));
  const held = await equipItem("bucket");
  if (!held.ok) return held;
  await useHeldItemToward(source.position.offset(0.5, 0.9, 0.5));
  await sleep(600);
  return count("water_bucket") > 0 ? ok() : fail("refused", "the water didn't go in my bucket");
}

/**
 * Turns the top of a lava pool in sight into obsidian: water poured on a
 * shore block beside a lava source flows over the lava; then the water is
 * taken back. True when obsidian appeared.
 */
async function obsidianFromLava(): Promise<boolean> {
  const lavaId = bot.registry.blocksByName["lava"]?.id;
  if (lavaId === undefined) return false;
  const sources = bot
    .findBlocks({ matching: lavaId, maxDistance: 48, count: 128 })
    .map((p) => bot.blockAt(p))
    .filter((b): b is Block => b !== null && Number(b.getProperties()["level"] ?? 0) === 0);
  for (const lava of sources) {
    // A shore block level with the lava, open above, to pour on
    for (const d of [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]) {
      const shore = bot.blockAt(lava.position.plus(d));
      const above = bot.blockAt(lava.position.plus(d).offset(0, 1, 0));
      if (!isSolid(shore) || !isAirish(above)) continue;
      if (!(await fillWater()).ok) return false;
      await goTo(new pf.goals.GoalNear(shore!.position.x, shore!.position.y + 1, shore!.position.z, 3));
      if (!(await equipItem("water_bucket")).ok) return false;
      await useHeldItemToward(shore!.position.offset(0.5, 1, 0.5)); // the top face of the shore
      await sleep(2_500); // the water runs over the lava
      // Take the water back up (it's a source on the shore)
      if ((await equipItem("bucket")).ok) {
        await useHeldItemToward(shore!.position.offset(0.5, 1.4, 0.5));
        await sleep(600);
      }
      if (bot.blockAt(lava.position)?.name === "obsidian") return true;
    }
  }
  return false;
}

/**
 * True for obsidian safe to mine: solid ground under it (obsidian on top of
 * a lava pool drops into the lava when broken, and the bot follows). Pure.
 */
export function safeToMine(below: { name: string; boundingBox: string } | null): boolean {
  return below !== null && below.boundingBox === "block" && below.name !== "magma_block";
}

/** Mines up to `n` obsidian it can see that stands on solid ground. */
async function mineSafeObsidian(n: number): Promise<void> {
  const id = bot.registry.blocksByName["obsidian"]?.id;
  if (id === undefined) return;
  const { breakBlock } = await import("../../core/primitives");
  const { pickupNearbyItems } = await import("../../actions/pickup");
  const spots = bot.findBlocks({ matching: id, maxDistance: 48, count: 64 }).filter((p) => safeToMine(bot.blockAt(p.offset(0, -1, 0))));
  for (const p of spots) {
    if (isCommandCancelled() || count("obsidian") >= OBSIDIAN || n <= 0) break;
    if (!(await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 3))).ok) continue;
    if ((await breakBlock(p)).ok) n--;
    await pickupNearbyItems(bot, 4);
  }
}

/** Gets 10 obsidian: mined where it sees some, else made from a lava pool first. */
async function getObsidian(): Promise<ActionResult> {
  const { toolTier, TIER } = await import("../capabilities");
  if (toolTier("pickaxe") < TIER.diamond) return fail("no_tool", "obsidian needs a diamond pickaxe");
  for (let tries = 0; tries < 6 && count("obsidian") < OBSIDIAN; tries++) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    const before = count("obsidian");
    await mineSafeObsidian(OBSIDIAN - before);
    if (count("obsidian") >= OBSIDIAN) break;
    if (!(await obsidianFromLava())) {
      // Lava is common deep down: a mining trip looks for it
      const { mineFor } = await import("../mine");
      await mineFor("cobblestone", 8);
      if (!(await obsidianFromLava()) && count("obsidian") === before) break;
    }
  }
  return count("obsidian") >= OBSIDIAN ? ok() : fail("missing_items", `I have ${count("obsidian")} of 10 obsidian and found no more (no obsidian or lava pool in sight)`);
}

/**
 * A spot near here for the portal: flat solid ground under the bottom row
 * and its corners, everything of the frame, its corners and inside open.
 */
function findSite(): { inner: Vec3; axis: Axis } | null {
  const me = bot.entity.position.floored();
  for (let r = 2; r <= 8; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (const axis of ["x", "z"] as Axis[]) {
          // Ground level: the first solid block at or below the bot's feet
          for (let dy = 1; dy >= -2; dy--) {
            const ground = me.offset(dx, dy - 1, dz);
            if (!isSolid(bot.blockAt(ground))) continue;
            const inner = ground.offset(0, 2, 0); // bottom row sits on the ground
            const a = axis === "x" ? new Vec3(1, 0, 0) : new Vec3(0, 0, 1);
            const { frame, inside } = portalFrame(inner, axis);
            const corners = [inner.minus(a).offset(0, -1, 0), inner.plus(a.scaled(2)).offset(0, -1, 0), inner.minus(a).offset(0, 3, 0), inner.plus(a.scaled(2)).offset(0, 3, 0)];
            const cells = [...frame, ...inside, ...corners].map(v);
            if (!cells.every((c) => isAirish(bot.blockAt(c)))) continue;
            const under = [inner.offset(0, -2, 0), inner.plus(a).offset(0, -2, 0), corners[0]!.offset(0, -1, 0), corners[1]!.offset(0, -1, 0)];
            if (!under.every((c) => isSolid(bot.blockAt(c)))) continue;
            return { inner, axis };
          }
        }
      }
    }
  }
  return null;
}

/** Builds the frame (cobblestone corners hold it up while it's built) and lights it. */
export async function buildNetherPortal(): Promise<ActionResult> {
  if (portalStands()) return ok();
  const { acquire } = await import("../acquire");
  const { liveWorld } = await import("../world");
  for (const item of ["flint_and_steel", "cobblestone"]) {
    const n = item === "cobblestone" ? 4 : 1;
    if (count(item) < n) {
      const got = await acquire(item, n - count(item), liveWorld);
      if (!got.ok) return fail(got.reason, `no ${item.replace(/_/g, " ")} for the portal (${describeFailure(got)})`);
    }
  }
  const obsidian = await getObsidian();
  if (!obsidian.ok) return obsidian;
  // Near home
  const { shelter } = await import("../capabilities");
  const home = shelter();
  if (home) await goTo(new pf.goals.GoalNear(home.x, home.y, home.z, 6));
  const site = findSite();
  if (!site) return fail("not_found", "I found no flat open spot for the portal near here");
  const { inner, axis } = site;
  const a = axis === "x" ? new Vec3(1, 0, 0) : new Vec3(0, 0, 1);
  const { frame, inside } = portalFrame(inner, axis);
  const corner = (side: number, top: boolean): Vec3 => (side < 0 ? inner.minus(a) : inner.plus(a.scaled(2))).offset(0, top ? 3 : -1, 0);
  const { placeBlockResult } = await import("../../actions/blockPlacing");
  const place = async (name: string, p: Vec3): Promise<boolean> => {
    if (bot.blockAt(p)?.name === name) return true;
    await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 3));
    return (await placeBlockResult(name, p.x, p.y, p.z)).ok;
  };
  // Bottom corners, the bottom row, the sides bottom up, top corners, the top row
  const bottom = frame.filter((c) => c.y === inner.y - 1).map(v);
  const sides = frame.filter((c) => c.y >= inner.y && c.y <= inner.y + 2).map(v).sort((p, q) => p.y - q.y);
  const top = frame.filter((c) => c.y === inner.y + 3).map(v);
  const steps: [string, Vec3][] = [
    ["cobblestone", corner(-1, false)],
    ["cobblestone", corner(1, false)],
    ...bottom.map((p): [string, Vec3] => ["obsidian", p]),
    ...sides.map((p): [string, Vec3] => ["obsidian", p]),
    ["cobblestone", corner(-1, true)],
    ["cobblestone", corner(1, true)],
    ...top.map((p): [string, Vec3] => ["obsidian", p]),
  ];
  for (const [name, p] of steps) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    if (!(await place(name, p))) return fail("refused", `I couldn't place ${name} at ${p} for the portal`);
  }
  // Light it from inside the frame: flint and steel on the bottom row's top
  if (!inside.every((c) => isAirish(bot.blockAt(v(c))))) return fail("refused", "something is inside the portal frame");
  await goTo(new pf.goals.GoalNear(inner.x, inner.y, inner.z, 3));
  if (!(await equipItem("flint_and_steel")).ok) return fail("missing_items", "no flint and steel");
  const base = bot.blockAt(bottom[0]!);
  if (base) await useBlock(base);
  await sleep(1_000);
  if (bot.blockAt(inner)?.name !== "nether_portal") return fail("refused", "the portal didn't light");
  await noteEndgame({ overworldPortal: { x: inner.x, y: inner.y, z: inner.z } });
  report(`My Nether portal is lit at ${inner.x}, ${inner.y}, ${inner.z}!`);
  return ok();
}
