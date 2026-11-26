// Path: src/skills/mine.ts
// The bot's mine (owner's design): from the exit in the shelter room's far
// wall, a diagonal staircase down. Where the stairs end is a hub: from it the
// bot digs three long tunnels, forward (the stairs' way), then right, then
// left, up to 50 blocks each, mining the ores they uncover. A blocker (water
// or lava it can't plug, a drop, something built) ends that tunnel and it
// goes on with the next. When all three are done, the stairs go 20 steps
// deeper to a new hub, and it starts over. Progress is remembered with the
// mine, so the next trip carries on where the last one stopped.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { isNatural, protectCells, setOwnPassages } from "../core/movements";
import { goTo } from "../core/primitives";
import { describeFailure, fail, ok, type ActionResult } from "../core/result";
import { isCommandCancelled } from "../core/commandContext";
import { chatter, report } from "../core/narrator";
import { addPlace, getPlaces } from "../managers/persistenceManager";
import { currentDimension } from "../actions/perception";
import { digDiagonalTunnel, digStraightTunnel, tunnelStopReason, type DirectionType } from "../actions/digging";
import { collectBlock } from "../actions/collectBlock";
import { shelterSlots } from "../actions/building";
import { foodPoints, shelter, TIER, toolTier } from "./capabilities";

export const MINE_DEPTH = 10;
const BRANCH_EVERY = 3; // the old layout's main tunnel steps (older mines)
export const ARM_LENGTH = 50; // each tunnel from a hub
export const LEVEL_STEP = 20; // stairs further down to the next hub
const CHUNK = 5; // dug at a time, then the ores it uncovered
const MAX_LEVELS = 4; // hubs at 10, 30, 50, 70 steps: deep enough for diamonds
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

/** The three tunnels from a hub, in the order they're dug. */
export const ARMS = ["forward", "right", "left"] as const;
export type ArmName = (typeof ARMS)[number];
export type Arm = { dug: number; blocked: boolean };
export type Arms = Record<ArmName, Arm>;
const freshArms = (): Arms => ({ forward: { dug: 0, blocked: false }, right: { dug: 0, blocked: false }, left: { dug: 0, blocked: false } });

/** The tunnel to dig next at this hub (forward, then right, then left), or null when all three are done. Pure. */
export function nextArm(arms: Arms): ArmName | null {
  return ARMS.find((a) => !arms[a].blocked && arms[a].dug < ARM_LENGTH) ?? null;
}

/** Which way an arm goes from the hub. Pure. */
export function armDirection(arm: ArmName, dir: DirectionType): DirectionType {
  return arm === "forward" ? dir : arm === "right" ? RIGHT[dir] : LEFT[dir];
}

/** The stair step a hub sits on: the first at the bottom of the stairs, each next one LEVEL_STEP deeper. Pure. */
export const hubStep = (level: number): number => MINE_DEPTH + level * LEVEL_STEP;

// The stairs' open cells above each step: the step and 3 more, 4 high (owner:
// 3 was too low, a player hit their head on the way up)
export const STAIR_HEADROOM = 3;

// Stairs are steps 0..MINE_DEPTH: the exit cell, then one down per step
const STAIRS = MINE_DEPTH + 1;
// Stairs blocked (water, lava) this deep or deeper: the mine just ends there
const SHALLOWEST_MINE = 3;

type MineRecord = { start: Pos; direction: DirectionType; stairs: number; branches: number; bottom: Vec3 | null; level: number; arms: Arms; deepest: boolean };

/**
 * True for a block that has fallen into (or grown into) a step's walking
 * space and must be dug out: solid, natural (gravel, sand, stone, dirt),
 * never its own paving (a stair block sits in the step it paves: the review
 * found every trip dug the paving out again) nor anything else built. Pure.
 */
export function fillsStep(b: { name: string; boundingBox: string } | null): boolean {
  return b !== null && b.boundingBox === "block" && !b.name.endsWith("_stairs") && isNatural(b.name);
}

/**
 * The hub of its mine nearest `pos` in height (where the tunnels leave the
 * stairs): the place for a table or a furnace in the mine, beside the
 * tunnels, never in the stairs. Null without a mine.
 */
export function nearestMineHub(pos: Pos): Vec3 | null {
  const rec = mineRecord();
  if (!rec) return null;
  let best: Vec3 | null = null;
  for (let level = 0; level <= rec.level; level++) {
    if (hubStep(level) >= rec.stairs) break; // not dug down to yet (review: off by one)
    const hub = new Vec3(rec.start.x, rec.start.y, rec.start.z).plus(STEP[rec.direction].scaled(hubStep(level))).offset(0, -hubStep(level), 0);
    if (!best || Math.abs(hub.y - pos.y) < Math.abs(best.y - pos.y)) best = hub;
  }
  return best;
}

/**
 * The step of its mine's stairs nearest `pos` (the way up from wherever it
 * is in its mine), or null without a mine. Pure over the record.
 */
export function nearestStairStep(pos: Pos, start: Pos, dir: DirectionType, stairs: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < stairs; i++) {
    const s = stepAt(start, dir, i);
    const d = Math.hypot(s.x - pos.x, s.y - pos.y, s.z - pos.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Up its mine's stairs from down in its mine: to the nearest step, then up
 * them to the top (the shelter's back door). True when it got to the top.
 * Game test: walking home from 35 blocks down the pathfinder dug straight up
 * through the rock to under the shelter, then a new way to the surface
 * beside its entrance stairs, instead of taking the stairs it had dug.
 */
export async function climbMineStairs(): Promise<boolean> {
  const rec = mineRecord();
  if (!rec || rec.stairs < 2) return false;
  const here = bot.entity.position;
  // Only from down in its mine, near it
  if (here.y > rec.start.y - 3 || Math.hypot(here.x - rec.start.x, here.z - rec.start.z) > 96) return false;
  const i = nearestStairStep(here, rec.start, rec.direction, rec.stairs);
  if (i === null) return false;
  const step = standAt(stepAt(rec.start, rec.direction, i));
  console.log(`Home by my mine's stairs: from step ${i} up.`);
  if (!(await goTo(new pf.goals.GoalNear(step.x, step.y, step.z, 1))).ok) return false;
  // Up them a stretch at a time (each leg short, so it keeps to the stairs);
  // stuck on a leg, it gets itself up a block and tries again (owner)
  let unsticks = 0;
  for (let j = Math.max(0, i - 8); ; ) {
    if (isCommandCancelled()) return false;
    const s = standAt(stepAt(rec.start, rec.direction, j));
    if (!(await goTo(new pf.goals.GoalNear(s.x, s.y, s.z, 1))).ok) {
      if (unsticks >= 3 || !(await unstickOnStairs())) return false;
      unsticks++;
      continue;
    }
    if (j === 0) return true;
    j = Math.max(0, j - 8);
  }
}

/** A block to put under itself: a stair block first (it's the floor there), else cobblestone or dirt. */
const UNSTICK_BLOCKS = ["cobblestone_stairs", "cobblestone", "cobbled_deepslate", "dirt"];

/**
 * Stuck on its stairs, like a player: the block over its head dug out if
 * it's natural, then a block put under its feet with a jump, a block up.
 * True when it got up.
 */
export async function unstickOnStairs(): Promise<boolean> {
  const feet = bot.entity.position.floored();
  const over = feet.offset(0, 2, 0);
  const b = bot.blockAt(over);
  const { breakBlock, pillarUp } = await import("../core/primitives");
  if (b && b.boundingBox === "block") {
    const { isNatural, isProtected } = await import("../core/movements");
    if (!isNatural(b.name) || isProtected(over)) return false;
    if (!(await breakBlock(over)).ok) return false;
  }
  const block = UNSTICK_BLOCKS.find((n) => carried([n]) > 0);
  if (!block) return false;
  const up = await pillarUp(block);
  console.log(up.ok ? `Stuck on my stairs at ${feet}: put ${block.replace(/_/g, " ")} under me and got up a block.` : `Stuck on my stairs at ${feet}: couldn't get up (${describeFailure(up)}).`);
  return up.ok;
}

/**
 * Where its tunnels leave each hub (forward, right and left, the first cell
 * of each): never a niche for a table or a furnace (review: one dug there
 * would later stop that tunnel as "something built").
 */
export function mineArmStarts(): Vec3[] {
  const rec = mineRecord();
  if (!rec) return [];
  const out: Vec3[] = [];
  for (let level = 0; level <= rec.level; level++) {
    const hub = new Vec3(rec.start.x, rec.start.y, rec.start.z).plus(STEP[rec.direction].scaled(hubStep(level))).offset(0, -hubStep(level), 0);
    for (const arm of ["forward", "right", "left"] as const) {
      const cell = hub.plus(STEP[armDirection(arm, rec.direction)]);
      out.push(cell, cell.offset(0, 1, 0));
    }
  }
  return out;
}

/** The mine record (stairs maybe not finished): stairs dug so far, branches done, the bottom once finished. */
function mineRecord(): MineRecord | null {
  const dim = currentDimension();
  const mine = getPlaces("mine").find((m) => m.name === MINE_NAME && m.dimension === dim);
  if (!mine) return null;
  const d = (mine.details ?? {}) as { direction?: DirectionType; stairs?: number; depth?: number; branches?: number; endsAt?: Pos; done?: boolean; level?: number; arms?: Arms; deepest?: boolean };
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
    level: d.level ?? 0,
    // An older mine (main tunnel with side branches): its main tunnel is the
    // start of the forward tunnel
    arms: d.arms ?? { ...freshArms(), forward: { dug: Math.min(ARM_LENGTH, (d.branches ?? 0) * BRANCH_EVERY), blocked: false } },
    deepest: d.deepest ?? false,
  };
}

/**
 * Its mine stairs off limits to walks and collecting: each step's floor, and
 * its side walls except at the hubs (their tunnels start there). A walk stuck
 * on a step dug around it and broke the stairs (owner: "unacceptable"). The
 * steps themselves are its own passage: a stall there never sends it round
 * through the caves. The doorway (step 0) is the shelter's.
 */
export async function protectMine(): Promise<void> {
  const rec = mineRecord();
  if (!rec) {
    protectCells([], "mine");
    setOwnPassages([], "mine");
    return;
  }
  const { keep, walk } = mineStairCells(rec.start, rec.direction, rec.stairs, rec.level);
  // The ground over the shallow stairs too, up to over the surface (a walk
  // home dug down into them from the grass): only protected, never "mended"
  const surface = (shelter()?.details?.["start"] as Pos | undefined)?.y ?? rec.start.y + 6;
  const { overburden } = await import("../actions/building");
  const above = overburden(walk.filter((c) => c.y > stepAt(rec.start, rec.direction, hubStep(0)).y), keep, surface + 3);
  protectCells([...keep, ...above], "mine");
  setOwnPassages(walk, "mine");
}

/** The stairs' protected cells (floors, roofs, side walls but the hubs') and walking cells (each step's open space). Pure. */
export function mineStairCells(start: Pos, dir: DirectionType, stairs: number, level: number): { keep: Vec3[]; walk: Vec3[] } {
  const keep: Vec3[] = [];
  const walk: Vec3[] = [];
  for (let i = 0; i < stairs; i++) {
    const s = stepAt(start, dir, i);
    for (let dy = 0; dy <= STAIR_HEADROOM; dy++) walk.push(s.offset(0, dy, 0));
    keep.push(...stepShell(start, dir, i, level));
  }
  return { keep, walk };
}

/**
 * One step's floor, roof and side walls (none for the doorway, no side
 * walls at a hub). The roof too: a walk home dug down from the grass into
 * the stairs behind the shelter, and a skeleton came in that way. Pure.
 */
function stepShell(start: Pos, dir: DirectionType, i: number, level: number): Vec3[] {
  if (i === 0) return [];
  const s = stepAt(start, dir, i);
  const cells = [s.offset(0, -1, 0)];
  // The roof only above the first hub, near the surface: deeper, the stairs
  // run under the first level's forward tunnel, which is a step's "roof" there
  if (i < hubStep(0)) cells.push(s.offset(0, STAIR_HEADROOM + 1, 0));
  const hubs = new Set(Array.from({ length: level + 1 }, (_, l) => hubStep(l)));
  if (hubs.has(i)) return cells;
  for (const side of [STEP[armDirection("right", dir)], STEP[armDirection("left", dir)]]) {
    for (let dy = -1; dy <= STAIR_HEADROOM; dy++) cells.push(s.plus(side).offset(0, dy, 0));
  }
  return cells;
}

// A torch on the stairs every this many steps (owner: a skeleton in its dark
// stairs shot it at its own door)
const STAIR_TORCH_EVERY = 6;

/**
 * Its stairs looked after on the way down: holes in a step's floor or side
 * walls filled (a walk stuck on a step had dug round it; caves open into
 * them), and a torch wherever a stretch is dark. Best effort: a hole it can't
 * fill or a torch it can't make doesn't stop the trip.
 */
export async function lookAfterStairs(): Promise<void> {
  const rec = mineRecord();
  if (!rec) return;
  const { isHoleBlock, ensureBlock, lightSpot } = await import("../actions/digging");
  const { walk } = mineStairCells(rec.start, rec.direction, rec.stairs, rec.level);
  const walkSet = new Set(walk.map((c) => c.toString()));
  const inWalk = (p: Vec3): boolean => walkSet.has(p.toString());
  const torchIds = ["torch", "wall_torch"].map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  const darkAt = (s: Vec3): boolean => bot.findBlocks({ matching: torchIds, point: s, maxDistance: 5, count: 1 }).length === 0;
  let filled = 0;
  let lit = 0;
  let raised = 0;
  let cleared = 0;
  let noTorch = "";
  for (let i = 1; i < rec.stairs; i++) {
    if (isCommandCancelled()) return;
    const s = stepAt(rec.start, rec.direction, i);
    const holes = stepShell(rec.start, rec.direction, i, rec.level).filter((c) => isHoleBlock(bot.blockAt(c)));
    const torch = !noTorch && i % STAIR_TORCH_EVERY === 0 && darkAt(s);
    // Stairs dug before they were made a block higher: the top cell dug out now
    const low = bot.blockAt(s.offset(0, STAIR_HEADROOM, 0));
    const raise = low !== null && low.boundingBox === "block" && !low.name.includes("torch");
    // Gravel or sand fallen into the step (or anything else filling it):
    // walks won't dig a block with gravel over it, so it stood on the step
    // above for five minutes (game test; the owner dug it out by hand)
    const fallen = Array.from({ length: STAIR_HEADROOM }, (_, dy) => s.offset(0, dy, 0)).filter((c) => fillsStep(bot.blockAt(c)));
    if (holes.length === 0 && !torch && !raise && fallen.length === 0) continue;
    // A hole in this step's own floor, or the step filled: worked on from the step above
    const floorHole = holes.some((h) => h.equals(s.offset(0, -1, 0)));
    const stand = floorHole || fallen.length > 0 ? stepAt(rec.start, rec.direction, i - 1) : s;
    const there = await goToStep(stand);
    if (!there.ok) continue;
    if (fallen.length > 0) {
      const { breakBlock } = await import("../core/primitives");
      // Top down, again while more gravel falls in from above
      for (const c of [...fallen].reverse()) {
        for (let k = 0; k < 12 && bot.blockAt(c)?.boundingBox === "block" && !isCommandCancelled(); k++) {
          if (!(await breakBlock(c)).ok) break;
          cleared++;
          await new Promise((r) => setTimeout(r, 400)); // the next gravel falls
        }
      }
      if (fallen.some((c) => bot.blockAt(c)?.boundingBox === "block")) continue; // still blocked: not this trip
      const { pickupNearbyItems } = await import("../actions/pickup");
      await pickupNearbyItems(bot, 4);
      // Now stand on it for the rest (holes, torches)
      if (!(await goToStep(s)).ok) continue;
    }
    for (const hole of holes) if (await ensureBlock(hole, inWalk)) filled++;
    if (raise) {
      const { breakBlock } = await import("../core/primitives");
      if ((await breakBlock(s.offset(0, STAIR_HEADROOM, 0))).ok) raised++;
    }
    if (torch) {
      const placed = await lightSpot(s.offset(0, 1, 0), rec.direction);
      if (placed === true) lit++;
      else noTorch = placed; // no torches or coal: not again this trip
    }
  }
  if (filled + lit + raised + cleared > 0) console.log(`Mine: looked after my stairs: ${filled} holes filled, ${lit} torches put up, ${raised} steps made a block higher, ${cleared} fallen blocks dug out.`);
  if (noTorch) console.log(`Mine: my stairs stay dark in places (${noTorch}).`);
}

async function saveMine(start: Pos, direction: DirectionType, stairs: number, branches: number, bottom: Vec3 | null, levels?: { level: number; arms: Arms; deepest: boolean }): Promise<void> {
  const endsAt = bottom ?? mineBottom(start, direction);
  const keep = levels ?? (() => {
    const rec = mineRecord();
    return rec ? { level: rec.level, arms: rec.arms, deepest: rec.deepest } : { level: 0, arms: freshArms(), deepest: false };
  })();
  await addPlace({
    kind: "mine",
    name: MINE_NAME,
    dimension: currentDimension(),
    ...start,
    details: { direction, depth: MINE_DEPTH, stairs, done: bottom !== null, endsAt: { x: endsAt.x, y: endsAt.y, z: endsAt.z }, branches, ...keep },
  });
  protectMine();
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
 * Where to stand to be at a step or a hub: the cell itself, or on top of it
 * once it's paved (a stair block fills the cell: walks aimed inside it got
 * "0 moves" after the hubs were paved, game test).
 */
function standAt(cell: Vec3): Vec3 {
  return bot.blockAt(cell)?.name.endsWith("_stairs") ? cell.offset(0, 1, 0) : cell;
}

/** Walks to stand at a step, a hub or a tunnel's end (paved or not). */
const goToStep = (cell: Vec3): Promise<ActionResult> => {
  const at = standAt(cell);
  return goTo(new pf.goals.GoalBlock(at.x, at.y, at.z));
};

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
    if (!(await digDiagonalTunnel(dir, 0, { width: 1, height: STAIR_HEADROOM }, stepAt(start, dir, i), MINE_NAME, undefined, { save: false }))) {
      const why = tunnelStopReason();
      // Stopped (the owner, something more urgent): carry on from this step next time
      if (isCommandCancelled() || why === null) {
        await saveMine(start, dir, i, 0, null);
        return fail("aborted", "stopped");
      }
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
 * The stair steps that get a stair block (owner: cobblestone stairs all the
 * way down make the walk quick): every step below the doorway (step 0) that
 * has a dug step below it to stand on, except the hubs, which stay flat for
 * their tunnels. Pure.
 */
export function stepsToPave(stairs: number): number[] {
  // Every step below the doorway, hubs too (owner: a flat hub between paved
  // steps is a step and a half up, which no one can walk; game test). The
  // bottom step is paved from its forward tunnel, the rest from the step below
  const steps: number[] = [];
  for (let i = 1; i < stairs; i++) steps.push(i);
  return steps;
}

/** The hub steps of a mine `level` levels deep (where the side tunnels leave the stairs). Pure. */
export function hubSteps(level: number): Set<number> {
  return new Set(Array.from({ length: level + 1 }, (_, l) => hubStep(l)));
}

/** The steps of its mine's stairs still without a stair block (as far as it can see). */
export function unpavedSteps(): number[] {
  const rec = mineRecord();
  if (!rec?.bottom) return [];
  return stepsToPave(rec.stairs).filter((i) => {
    const step = stepAt(rec.start, rec.direction, i);
    const b = bot.blockAt(step);
    if (b === null || b.name.endsWith("_stairs")) return false;
    // The bottom step is paved from its forward tunnel: none dug yet (or
    // blocked), nothing to stand on to pave it, so it isn't counted (review:
    // it could never be done, and held the mine stage up)
    if (i === rec.stairs - 1) return bot.blockAt(step.plus(STEP[rec.direction]))?.boundingBox === "empty";
    return true;
  });
}

/** True when its mine has stairs to pave and every one of them is paved. */
export function stairsPaved(): boolean {
  const rec = mineRecord();
  return Boolean(rec?.bottom) && stepsToPave(rec!.stairs).length > 0 && unpavedSteps().length === 0;
}

/**
 * Paves its mine's stairs: one more block of headroom over each step, then a
 * cobblestone stair block on it, placed standing on the step below and
 * facing up the tunnel, so its high side is toward the shelter and walking
 * up is a slope, not a jump per step.
 */
/** Stair blocks to make for `steps` bare steps: all of them and 10% spare (at least one). Pure. */
export function stairsToMake(steps: number): number {
  return steps <= 0 ? 0 : steps + Math.max(1, Math.ceil(steps * 0.1));
}

// Stairs blocked going deeper (water, lava, a fall of gravel): tried again after this long
const STAIRS_RETRY_MS = 15 * 60_000;
let stairsBlockedUntil = 0;

export async function paveMineStairs(): Promise<ActionResult> {
  return withScaffoldingTakenDown(paveSteps);
}

async function paveSteps(): Promise<ActionResult> {
  const rec = mineRecord();
  if (!rec?.bottom) return fail("not_found", "no mine yet");
  const steps = unpavedSteps();
  if (steps.length === 0) return ok();
  // Counted first: every bare step plus 10% spare (a stair placed wrong, a
  // step that breaks), all made at home before it goes down (owner; game
  // test: it tried crafting them down in the mine, where it couldn't reach a
  // table, and paved nothing)
  const want = stairsToMake(steps.length);
  const have = carried(["cobblestone_stairs"]);
  if (have < want) {
    const { enterShelter } = await import("../actions/building");
    const home = await enterShelter();
    if (!home.ok) console.log(`Paving: couldn't get home to the table first (${describeFailure(home)}).`);
    // Cobblestone from its chests (6 make 4 stairs), crafted at the shelter's table
    const cobble = Math.ceil((want - have) / 4) * 6 - carried(["cobblestone"]);
    if (cobble > 0) {
      const { takeItems } = await import("../actions/storage");
      await takeItems([{ name: "cobblestone", count: cobble + 4 }], true);
    }
    const { acquire } = await import("./acquire");
    const { liveWorld } = await import("./world");
    const made = await acquire("cobblestone_stairs", want, liveWorld);
    if (!made.ok && carried(["cobblestone_stairs"]) === 0) return made;
    console.log(`Paving: ${carried(["cobblestone_stairs"])} cobblestone stairs for ${steps.length} steps.`);
  }
  report(`Paving my mine's stairs: ${steps.length} steps.`);
  const { breakBlock } = await import("../core/primitives");
  const { placeBlockResult } = await import("../actions/blockPlacing");
  let paved = 0;
  const hubs = hubSteps(rec.level);
  for (const i of steps) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    if (carried(["cobblestone_stairs"]) === 0) break;
    const step = stepAt(rec.start, rec.direction, i);
    // Placed facing up the stairs: from the step below, or (the bottom step)
    // from its forward tunnel, which is level with it
    const stand = i + 1 < rec.stairs ? stepAt(rec.start, rec.direction, i + 1) : step.plus(STEP[rec.direction]);
    if (i + 1 >= rec.stairs && bot.blockAt(stand)?.boundingBox !== "empty") continue;
    // A step already paved is stood on, not in (the hubs come after the
    // steps below them were paved: its walk aimed inside the stair block,
    // "0 moves", game test)
    const there = await goToStep(stand);
    if (!there.ok) continue;
    // One block more headroom over the step (a stair raises the floor half a block)
    const head = step.offset(0, 3, 0);
    if (bot.blockAt(head)?.boundingBox === "block") await breakBlock(head);
    const placed = await placeBlockResult("cobblestone_stairs", step.x, step.y, step.z, "bottom");
    if (placed.ok) paved++;
    // A hub, now half a block up: the block over each side tunnel's opening
    // dug out, so stepping off it into a side tunnel has headroom (owner)
    if (placed.ok && hubs.has(i)) {
      for (const side of [STEP[armDirection("right", rec.direction)], STEP[armDirection("left", rec.direction)]]) {
        const opening = step.plus(side);
        if (bot.blockAt(opening)?.boundingBox !== "empty") continue; // no tunnel that way
        const over = opening.offset(0, 2, 0);
        if (bot.blockAt(over)?.boundingBox === "block") await breakBlock(over);
      }
    }
  }
  console.log(`Mine: paved ${paved} of ${steps.length} stair steps.`);
  return unpavedSteps().length === 0 ? ok() : fail("refused", `${unpavedSteps().length} of my mine's steps aren't paved yet`);
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
// Owner: with 10 or more it takes them home to smelt
export const IRON: OreWant = { item: "raw_iron", enough: 10, counts: ["raw_iron", "iron_ingot"] };

// Before a trip down, like a player: not badly hurt, and food to eat down there
const MIN_HEALTH_TO_GO_DOWN = 12;
const MIN_FOOD_TO_GO_DOWN = 6;

/**
 * Whether it's fit for a mining trip: health and the food points it carries.
 * Game test: it went down hurt and with little food, and died in the caves
 * four times in one night. Pure.
 */
export function fitForTheMine(health: number, food: number): ActionResult {
  if (health < MIN_HEALTH_TO_GO_DOWN) return fail("refused", `I'm hurt (health ${Math.round(health)} of 20); healing before I go down the mine`);
  if (food < MIN_FOOD_TO_GO_DOWN) return fail("missing_items", "I have too little food to take down the mine");
  return ok();
}

/**
 * Mining until it has enough of what it wants (or a trip's worth of digging,
 * CHUNK blocks at a time): the hub's forward, right and left tunnels in
 * turn, deeper when all three are done, and the ores they uncover.
 */
export async function branchMine(wants: OreWant[], chunksThisTrip = 12): Promise<ActionResult> {
  return withScaffoldingTakenDown(() => branchMineSteps(wants, chunksThisTrip));
}

async function branchMineSteps(wants: OreWant[], tripChunks: number): Promise<ActionResult> {
  const first = myMine();
  if (!first) return fail("not_found", "no mine yet");
  if (!hasStonePickaxe()) return fail("no_tool", "I mine with a stone pickaxe, and I have none yet");
  const still = (): OreWant[] => wants.filter((w) => carried(w.counts) < w.enough);
  if (still().length === 0) return ok();
  // Fit for it first (hurt or without food it doesn't go, not even for ore in the open)
  const fit = fitForTheMine(bot.health, foodPoints());
  if (!fit.ok) return fit;
  // By day, ore of what it wants in the open round its home first (a ravine
  // by the shelter), then down the mine for the rest
  const { surfaceOresFirst } = await import("./surfaceOres");
  for (const w of still()) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    if (w.item !== "cobblestone") await surfaceOresFirst(w.item, w.enough - carried(w.counts));
  }
  if (still().length === 0) return ok();
  const stillNames = (): string => still().map((w) => w.item.replace(/_/g, " ")).join(" or ");

  await lookAfterStairs(); // holes mended and dark stretches lit on the way down
  let refilled = false; // once a trip: stone from the walls when it has nothing to build with
  for (let chunk = 0; chunk < tripChunks && still().length > 0; chunk++) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    const rec = mineRecord()!;
    const { start, direction: dir } = rec;
    let { level, arms } = rec;
    let arm = nextArm(arms);
    // All three tunnels at this hub done: 20 steps further down, a new hub
    if (!arm) {
      if (level + 1 >= MAX_LEVELS) return fail("not_found", `my mine goes no deeper and I still have too little ${stillNames()}`);
      // Its stairs were blocked going deeper: tried again after a while, not
      // never (game test: gravel fell in, "no path" to the next block, and
      // with one level of tunnels its mine was done for good: no iron, ever)
      if (rec.deepest && Date.now() < stairsBlockedUntil) return fail("not_found", `my mine's stairs were blocked going deeper; I'll dig on later (still too little ${stillNames()})`);
      level += 1;
      arms = freshArms();
      report(`My mine's tunnels here are done; digging the stairs ${LEVEL_STEP} steps deeper.`);
      const deeper = await digStairsTo(rec, hubStep(level));
      if (!deeper.ok) {
        if (deeper.reason !== "refused") return deeper;
        // Stairs blocked: this is as deep as it goes (the steps it did dig stay saved)
        const now = mineRecord() ?? rec;
        stairsBlockedUntil = Date.now() + STAIRS_RETRY_MS;
        await saveMine(start, dir, now.stairs, rec.branches, rec.bottom, { level: level - 1, arms: rec.arms, deepest: true });
        return fail("not_found", `my mine's stairs can't go deeper (${deeper.detail}) and I still have too little ${stillNames()}`);
      }
      await saveMine(start, dir, hubStep(level) + 1, rec.branches, rec.bottom, { level, arms, deepest: false });
      arm = nextArm(arms)!;
    }
    // Down to where this tunnel ends now, then on a few blocks
    const hub = stepAt(start, dir, hubStep(level));
    const way = armDirection(arm, dir);
    const end = hub.plus(STEP[way].scaled(arms[arm].dug));
    const there = await goToStep(end);
    if (!there.ok) {
      if (isCommandCancelled()) return fail("aborted", "stopped");
      // Can it get to the hub? Then this tunnel's end is what's out of reach:
      // that tunnel is done, on with the next (it failed there every trip)
      let atHub = await goToStep(hub);
      // The stairs down may be blocked (gravel fallen in): looked after once, then again
      if (!atHub.ok && !isCommandCancelled()) {
        await lookAfterStairs();
        atHub = await goToStep(hub);
      }
      if (!atHub.ok) return there;
      console.log(`Mine: can't get to the end of my ${arm} tunnel (${there.detail}); it's done.`);
      arms = { ...arms, [arm]: { dug: arms[arm].dug, blocked: true } };
      await saveMine(start, dir, Math.max(rec.stairs, hubStep(level) + 1), rec.branches, rec.bottom, { level, arms, deepest: rec.deepest });
      continue;
    }
    const length = Math.min(CHUNK, ARM_LENGTH - arms[arm].dug);
    const dug = await digStraightTunnel(way, length, end, 1);
    const stop = dug ? null : tunnelStopReason();
    if (stop === "no_tool") return fail("no_tool", "my pickaxe wore out in the mine");
    if (isCommandCancelled()) return fail("aborted", "stopped");
    // Nothing to build a floor or a plug with: stone from the tunnel walls,
    // then this tunnel again (not given up for want of a few blocks)
    if (stop === "no_filler" && !refilled) {
      refilled = true;
      const got = await collectBlock("stone", 16, ORE_REACH, { seenOnly: true });
      console.log(`Mine: out of blocks to build with; took ${got} stone from the walls.`);
      if (got > 0) continue;
    }
    arms = { ...arms, [arm]: dug ? { dug: arms[arm].dug + length, blocked: false } : { dug: arms[arm].dug, blocked: true } };
    const what = stop === "drop" ? "a drop I couldn't build a floor over" : stop === "no_filler" ? "a hole I had nothing to fill" : "water, lava or something it mustn't dig";
    if (!dug) chatter(`My ${arm} tunnel ${level ? `${level + 1} levels down ` : ""}hit ${what}; on with the next one.`, "mining");
    else if (arms[arm].dug >= ARM_LENGTH) chatter(`My ${arm} tunnel is ${ARM_LENGTH} blocks long; on with the next one.`, "mining");
    await saveMine(start, dir, Math.max(rec.stairs, hubStep(level) + 1), rec.branches, rec.bottom, { level, arms, deepest: rec.deepest });
    await mineOresInSight(wants);
  }
  return still().length === 0 ? ok() : fail("missing_items", `not enough ${stillNames()} yet (I'll mine on next time)`);
}

/**
 * Digs the mine's stairs on down to step `to` (a step at a time, from where
 * they end now), remembering each one. A blocked step stops it.
 */
async function digStairsTo(rec: MineRecord, to: number): Promise<ActionResult> {
  const { start, direction: dir } = rec;
  const from = Math.max(rec.stairs, 1);
  const top = stepAt(start, dir, from - 1);
  const atTop = await goToStep(top);
  // Not there (a walk that failed, a stop): try again next trip; never "as deep as it goes"
  if (!atTop.ok) return fail(atTop.reason === "aborted" ? "aborted" : "unreachable", atTop.detail);
  for (let i = from; i <= to; i++) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    if (!(await digDiagonalTunnel(dir, 0, { width: 1, height: STAIR_HEADROOM }, stepAt(start, dir, i), MINE_NAME, undefined, { save: false }))) {
      if (isCommandCancelled()) return fail("aborted", "stopped");
      const why = tunnelStopReason();
      if (why === "no_tool") return fail("no_tool", "my pickaxe wore out digging the stairs");
      if (why === "no_filler") return fail("missing_items", "nothing to build the stairs' floor with over a cave");
      // Only a real blocker means the stairs go no deeper
      if (why === "blocked" || why === "drop") return fail("refused", why === "drop" ? "a drop I can't build a floor over" : "water or lava I couldn't plug, or something built");
      return fail("unreachable", "the stairs stopped (I'll try again)");
    }
    await saveMine(start, dir, i + 1, rec.branches, rec.bottom);
  }
  return ok();
}

// What ores drop, best first: strip mining takes every one it sees
const STRIP_ORES = ["diamond", "emerald", "raw_gold", "raw_iron", "redstone", "lapis_lazuli", "raw_copper", "coal"];

/**
 * Strip mining (owner): every ore it can see from the fresh tunnel, not only
 * what this trip is for (it walked past coal on the wall because it had
 * "enough"). Best first; then the wanted count is said when it moved.
 */
async function mineOresInSight(wants: OreWant[]): Promise<void> {
  const before = new Map(wants.map((w) => [w.item, carried(w.counts)]));
  for (const item of STRIP_ORES) {
    if (isCommandCancelled()) return;
    await collectBlock(item, 16, ORE_REACH, { seenOnly: true });
  }
  for (const w of wants) {
    if (carried(w.counts) > (before.get(w.item) ?? 0)) chatter(`Found ${w.item.replace(/_/g, " ")}: ${carried(w.counts)} of ${w.enough}.`, "mining");
  }
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
/** What it carries that counts as `item` for mining (coal and charcoal, raw iron and ingots). */
export function carriedFor(item: string): number {
  return carried(item === "coal" ? COAL.counts : item === "raw_iron" ? IRON.counts : [item]);
}

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
  return branchMine([{ item, enough: target, counts }], 16);
}
