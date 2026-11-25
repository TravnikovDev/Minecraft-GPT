// Path: src/skills/mine.ts
// The bot's mine (owner's design): from the exit in the shelter room's far
// wall, a diagonal staircase 10 levels down, then branch mining at the bottom
// like a player: the main tunnel goes on 3 blocks at a time, with side
// tunnels 5 long to the left and right, and the ores it uncovers (coal, iron)
// are mined as it goes. Progress is remembered with the mine, so the next
// trip carries on where the last one stopped.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { goTo } from "../core/primitives";
import { fail, ok, type ActionResult } from "../core/result";
import { isCommandCancelled } from "../core/commandContext";
import { chatter, report } from "../core/narrator";
import { addPlace, getPlaces } from "../managers/persistenceManager";
import { currentDimension } from "../actions/perception";
import { digDiagonalTunnel, digStraightTunnel, tunnelStopReason, type DirectionType } from "../actions/digging";
import { collectBlock } from "../actions/collectBlock";
import { shelterSlots } from "../actions/building";
import { TIER, toolTier } from "./capabilities";
import { catalog } from "../core/catalog";

export const MINE_DEPTH = 10;
const BRANCH_EVERY = 3;
const BRANCH_LENGTH = 5;
const MAX_BRANCHES = 24; // about 72 blocks of main tunnel: plenty for a first mine
const ORE_REACH = 6; // ores this close to a fresh tunnel get mined
const MINE_NAME = "shelter mine";

const STEP: Record<DirectionType, Vec3> = { north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), east: new Vec3(1, 0, 0), west: new Vec3(-1, 0, 0) };
const LEFT: Record<DirectionType, DirectionType> = { north: "west", west: "south", south: "east", east: "north" };
const RIGHT: Record<DirectionType, DirectionType> = { north: "east", east: "south", south: "west", west: "north" };

type Pos = { x: number; y: number; z: number };

/** Where the stairs from `exit` going `dir` end (pure: tested on its own). */
export function mineBottom(exit: Pos, dir: DirectionType): Vec3 {
  return new Vec3(exit.x, exit.y, exit.z).plus(STEP[dir].scaled(MINE_DEPTH)).offset(0, -MINE_DEPTH, 0);
}

/** Branch `k` (1, 2, ...): where the main tunnel is then, and the two side directions. */
export function branchAt(bottom: Pos, dir: DirectionType, k: number): { main: Vec3; left: DirectionType; right: DirectionType } {
  return { main: new Vec3(bottom.x, bottom.y, bottom.z).plus(STEP[dir].scaled(BRANCH_EVERY * k)), left: LEFT[dir], right: RIGHT[dir] };
}

// Stairs are steps 0..MINE_DEPTH: the exit cell, then one down per step
const STAIRS = MINE_DEPTH + 1;
// Stairs blocked (water, lava) this deep or deeper: the mine just ends there
const SHALLOWEST_MINE = 3;

type MineRecord = { start: Pos; direction: DirectionType; stairs: number; branches: number; bottom: Vec3 | null };

/** The mine record (stairs maybe not finished): stairs dug so far, branches done, the bottom once finished. */
function mineRecord(): MineRecord | null {
  const dim = currentDimension();
  const mine = getPlaces("mine").find((m) => m.name === MINE_NAME && m.dimension === dim);
  if (!mine) return null;
  const d = (mine.details ?? {}) as { direction?: DirectionType; stairs?: number; depth?: number; branches?: number; endsAt?: Pos; done?: boolean };
  if (!d.direction) return null;
  // Older records (one dig of steps 0..10, saved when done) are finished
  const stairs = d.stairs ?? (d.depth === MINE_DEPTH ? STAIRS : 0);
  const done = d.done ?? stairs >= STAIRS;
  return {
    start: { x: mine.x, y: mine.y, z: mine.z },
    direction: d.direction,
    stairs,
    branches: d.branches ?? 0,
    bottom: done && d.endsAt ? new Vec3(d.endsAt.x, d.endsAt.y, d.endsAt.z) : null,
  };
}

async function saveMine(start: Pos, direction: DirectionType, stairs: number, branches: number, bottom: Vec3 | null): Promise<void> {
  const endsAt = bottom ?? mineBottom(start, direction);
  await addPlace({
    kind: "mine",
    name: MINE_NAME,
    dimension: currentDimension(),
    ...start,
    details: { direction, depth: MINE_DEPTH, stairs, done: bottom !== null, endsAt: { x: endsAt.x, y: endsAt.y, z: endsAt.z }, branches },
  });
}

/** Its mine under the shelter, once the stairs are dug: the bottom, the direction and branches done. */
export function myMine(): { bottom: Vec3; direction: DirectionType; branches: number; start: Pos } | null {
  const rec = mineRecord();
  if (!rec?.bottom) return null;
  return { bottom: rec.bottom, direction: rec.direction, branches: rec.branches, start: rec.start };
}

/** True with a stone pickaxe or better: the mine is dug with one (owner's rule). */
const hasStonePickaxe = (): boolean => toolTier("pickaxe") >= TIER.stone;

const stepAt = (start: Pos, dir: DirectionType, i: number): Vec3 => new Vec3(start.x, start.y, start.z).plus(STEP[dir].scaled(i)).offset(0, -i, 0);

/**
 * Digs the stairs down from the shelter's exit, a step at a time, remembering
 * how far it got. With a stone pickaxe, all the way; with only a wooden one,
 * just until it carries `woodUntilCobblestone` cobblestone (the owner's
 * allowance for the first stone tools), never further. Stairs blocked by
 * water or lava end the mine there when it's deep enough already.
 */
export async function digMine(woodUntilCobblestone = 0): Promise<ActionResult> {
  return withScaffoldingTakenDown(() => digMineSteps(woodUntilCobblestone));
}

async function digMineSteps(woodUntilCobblestone: number): Promise<ActionResult> {
  if (myMine()) return ok();
  const slots = shelterSlots();
  if (!slots?.exit || !slots.direction) return fail("not_found", "no shelter with an exit to start a mine from");
  if (toolTier("pickaxe") < TIER.wooden) return fail("no_tool", "no pickaxe to dig a mine");
  if (!hasStonePickaxe() && woodUntilCobblestone <= 0) return fail("no_tool", "I dig my mine with a stone pickaxe, and I have none yet");
  const rec = mineRecord();
  const start = rec?.start ?? slots.exit;
  const dir = rec?.direction ?? slots.direction;
  const from = rec?.stairs ?? 0;
  // From inside the shelter, never from the grass above it (that dug a hole
  // to the sky through the roof over the exit)
  const inside = await goTo(new pf.goals.GoalBlock(slots.stand.x, slots.stand.y, slots.stand.z));
  if (!inside.ok) return inside;
  if (from === 0) report(`Digging my mine: ${MINE_DEPTH} levels down from the back of my shelter.`);
  for (let i = from; i < STAIRS; i++) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    // The wooden pickaxe only for the cobblestone the stone tools need
    if (!hasStonePickaxe() && carried(["cobblestone"]) >= woodUntilCobblestone) {
      console.log(`Mine: ${i} of ${STAIRS} stairs, enough cobblestone for stone tools; the rest with a stone pickaxe.`);
      return ok();
    }
    if (!(await digDiagonalTunnel(dir, 0, { width: 1, height: 2 }, stepAt(start, dir, i), MINE_NAME, undefined, { save: false }))) {
      const why = tunnelStopReason();
      if (why === "no_tool") {
        await saveMine(start, dir, i, 0, null);
        return fail("no_tool", "my pickaxe wore out digging the mine");
      }
      // Over a cave with nothing to build the floor with: get dirt or
      // cobblestone (the planner) and carry on from this step next time
      if (why === "no_filler") {
        await saveMine(start, dir, i, 0, null);
        return fail("missing_items", "nothing to build my mine stairs' floor with over a cave (dirt or cobblestone)");
      }
      if (i - 1 >= SHALLOWEST_MINE) {
        // Water, lava or a drop it can't floor below: a mine this deep is still a mine
        console.log(`Mine: stairs stopped at step ${i} (${why ?? "stopped"}); the mine ends ${i - 1} levels down.`);
        await saveMine(start, dir, i, 0, stepAt(start, dir, i - 1));
        return ok();
      }
      await saveMine(start, dir, i, 0, null);
      return fail("refused", why === "drop" ? "my mine's stairs reach a drop near the top that I can't build a floor over" : "the mine's stairs hit lava, water or something built near the top");
    }
    await saveMine(start, dir, i + 1, 0, i + 1 >= STAIRS ? stepAt(start, dir, MINE_DEPTH) : null);
  }
  return myMine() ? ok() : fail("error", "the mine wasn't remembered");
}

/**
 * Runs a mining job, then takes down the scaffolding it put up on the way
 * (owner: blocks left standing in its tunnels block the way), unless it was
 * stopped.
 */
export async function withScaffoldingTakenDown(job: () => Promise<ActionResult>): Promise<ActionResult> {
  const result = await job();
  if (!isCommandCancelled()) {
    const { takeDownScaffolding } = await import("../actions/scaffolding");
    await takeDownScaffolding(true);
  }
  return result;
}

/** Carried count of these items. */
const carried = (names: string[]): number => bot.inventory.items().filter((i) => names.includes(i.name)).reduce((n, i) => n + i.count, 0);

/** What a mining trip is after: the item an ore drops, and how many of it are enough. */
export type OreWant = { item: string; enough: number; counts: string[] };
export const COAL: OreWant = { item: "coal", enough: 16, counts: ["coal", "charcoal"] };
export const IRON: OreWant = { item: "raw_iron", enough: 6, counts: ["raw_iron", "iron_ingot"] };

/**
 * Branch mining until it has enough of what it wants (or a few branches more
 * if this trip finds nothing): main tunnel 3 on, a side tunnel each way, and
 * the ores those uncover.
 */
export async function branchMine(wants: OreWant[], branchesThisTrip = 6): Promise<ActionResult> {
  return withScaffoldingTakenDown(() => branchMineSteps(wants, branchesThisTrip));
}

async function branchMineSteps(wants: OreWant[], branchesThisTrip: number): Promise<ActionResult> {
  const mine = myMine();
  if (!mine) return fail("not_found", "no mine yet");
  if (!hasStonePickaxe()) return fail("no_tool", "I mine with a stone pickaxe, and I have none yet");
  const still = (): OreWant[] => wants.filter((w) => carried(w.counts) < w.enough);
  if (still().length === 0) return ok();

  // Down the stairs to where the last trip stopped
  const from = mine.branches > 0 ? branchAt(mine.bottom, mine.direction, mine.branches).main : mine.bottom;
  const there = await goTo(new pf.goals.GoalBlock(from.x, from.y, from.z));
  if (!there.ok) return there;

  for (let i = 0; i < branchesThisTrip && still().length > 0; i++) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    const k = mine.branches + 1;
    if (k > MAX_BRANCHES) return fail("not_found", `my mine is ${MAX_BRANCHES} branches long and still not enough ${still().map((w) => w.item.replace(/_/g, " ")).join(" or ")}`);
    const before = branchAt(mine.bottom, mine.direction, k - 1).main;
    const at = branchAt(mine.bottom, mine.direction, k);
    if (!(await digStraightTunnel(mine.direction, BRANCH_EVERY, before, 1))) {
      // A worn-out pickaxe: the planner makes a new one (at the shelter's table)
      if (tunnelStopReason() === "no_tool") return fail("no_tool", "my pickaxe wore out in the mine");
      return fail("refused", "the main tunnel hit lava, water or something built");
    }
    // Side tunnels: a lava or water stop just ends that side
    for (const side of [at.left, at.right]) {
      if (isCommandCancelled()) return fail("aborted", "stopped");
      await digStraightTunnel(side, BRANCH_LENGTH, at.main, 1);
      if (tunnelStopReason() === "no_tool") return fail("no_tool", "my pickaxe wore out in the mine");
      await goTo(new pf.goals.GoalBlock(at.main.x, at.main.y, at.main.z));
    }
    mine.branches = k;
    await saveMine(mine.start, mine.direction, STAIRS, k, mine.bottom);
    // What the new tunnels uncovered (ores only: stone comes from the digging itself)
    for (const want of still().filter((w) => isOre(w.item))) {
      const got = await collectBlock(want.item, want.enough - carried(want.counts), ORE_REACH);
      if (got > 0) chatter(`Found ${want.item.replace(/_/g, " ")}: ${carried(want.counts)} of ${want.enough}.`, "mining");
    }
  }
  return still().length === 0 ? ok() : fail("missing_items", `not enough ${still().map((w) => w.item.replace(/_/g, " ")).join(" or ")} yet (I'll mine on next time)`);
}

/** An item ores drop (coal, raw iron), as opposed to plain stone. */
function isOre(item: string): boolean {
  return item !== "cobblestone" && catalog().oresFor(item).length > 0;
}

// Cobblestone the first stone tools take: 2 pickaxes, an axe, a shovel, a sword
export const FIRST_STONE = 11;

/**
 * Gets about `count` more of `item` (cobblestone, coal, raw iron...) the way
 * a player does, with the owner's rules in one place:
 * - no shelter yet: only what it can see from here (no tunnels at all);
 * - a shelter, but no stone pickaxe: cobblestone from the first mine stairs
 *   dug with the wooden pickaxe, just enough for the stone tools; ores only
 *   when in sight;
 * - a stone pickaxe: down its mine, carrying on with the tunnel.
 */
export async function mineFor(item: string, count: number): Promise<ActionResult> {
  const counts = item === "coal" ? COAL.counts : item === "raw_iron" ? IRON.counts : [item];
  const target = carried(counts) + count;
  const enough = (): boolean => carried(counts) >= target;
  const visible = async (): Promise<void> => {
    await collectBlock(item === "cobblestone" ? "stone" : item, target - carried(counts), 24, { seenOnly: true });
  };

  if (!shelterSlots()?.exit) {
    await visible();
    return enough() ? ok() : fail("not_found", `no ${item.replace(/_/g, " ")} in sight, and no shelter to start a mine from yet`);
  }
  if (!hasStonePickaxe()) {
    if (item !== "cobblestone") {
      await visible();
      return enough() ? ok() : fail("no_tool", `I mine for ${item.replace(/_/g, " ")} with a stone pickaxe, and I have none yet`);
    }
    // Blocked stairs (water near the top) must not stop stone tools for good:
    // stone in sight is the fallback
    const dug = await digMine(Math.max(target, FIRST_STONE));
    if (!enough()) await visible();
    if (!dug.ok && !enough()) return dug;
    return enough() ? ok() : fail("missing_items", "the mine's first stairs gave too little stone");
  }
  if (!myMine()) {
    const dug = await digMine();
    if (!dug.ok) return dug;
    if (enough()) return ok();
  }
  return branchMine([{ item, enough: target, counts }], 12);
}
