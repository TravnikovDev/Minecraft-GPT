// Path: src/skills/mine.ts
// The bot's mine (owner's design): from the exit in the shelter room's far
// wall, a diagonal staircase down. Where the stairs end is a hub: from it the
// bot digs three long tunnels, forward (the stairs' way), then right, then
// left, up to 50 blocks each, mining the ores they uncover. A blocker (water
// or lava it can't plug, a drop, something built) ends that tunnel and it
// goes on with the next. When all three are done, the stairs go 20 steps
// deeper to a new hub, and it starts over. Progress is remembered with the
// mine, so the next trip carries on where the last one stopped.

import { catalog } from "../core/catalog";
import { oreCapped } from "./oreCaps";
import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { isNatural, protectCells, setNoDig, setOwnPassages, whileGathering } from "../core/movements";
import { goTo, withinReach } from "../core/primitives";
import { pathing } from "../core/plugins";
import { describeFailure, fail, ok, type ActionResult } from "../core/result";
import { isCommandCancelled } from "../core/commandContext";
import { chatter, report } from "../core/narrator";
import { addPlace, getPlaces } from "../managers/persistenceManager";
import { currentDimension } from "../actions/perception";
import { digDiagonalTunnel, digStraightTunnel, ensureBlock, tunnelColumns, tunnelStopReason, type ColumnHooks, type DirectionType } from "../actions/digging";
import { collectBlock } from "../actions/collectBlock";
import { shelterSlots } from "../actions/building";
import { foodPoints, shelter, TIER, toolTier } from "./capabilities";

// The first floor this many steps down (owner: 20, not 10; at 10 the
// tunnels kept running into canyons and caves open to the sky). A mine dug
// before keeps its own (its record's depth).
export const MINE_DEPTH = 20;
// This mine's first floor's step (its record's depth; MINE_DEPTH for a new one)
let firstFloorAt = MINE_DEPTH;
const BRANCH_EVERY = 3; // the old layout's main tunnel steps (older mines)
export const ARM_LENGTH = 50; // each tunnel from a hub
// Floors (owner: every 10 blocks down, not 20)
export const LEVEL_STEP = 10; // stairs further down to the next floor
const CHUNK = 5; // dug at a time, then the ores it uncovered
// Down to just over bedrock (owner: dig down until the rock that can't be
// mined): no hub deeper than this, and never more than this many levels
// (owner: -54; below that the caves are mostly lava)
const MIN_HUB_Y = -54;
const MAX_LEVELS = 16;
const ORE_REACH = 6; // ores this close to a fresh tunnel get mined
const MINE_NAME = "shelter mine";

const STEP: Record<DirectionType, Vec3> = { north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), east: new Vec3(1, 0, 0), west: new Vec3(-1, 0, 0) };
const LEFT: Record<DirectionType, DirectionType> = { north: "west", west: "south", south: "east", east: "north" };
const RIGHT: Record<DirectionType, DirectionType> = { north: "east", east: "south", south: "west", west: "north" };

type Pos = { x: number; y: number; z: number };

/** Where the stairs from `exit` going `dir` end (pure: tested on its own). */
export function mineBottom(exit: Pos, dir: DirectionType): Vec3 {
  return new Vec3(exit.x, exit.y, exit.z).plus(STEP[dir].scaled(firstFloorAt)).offset(0, -firstFloorAt, 0);
}

/** The three tunnels from a hub, in the order they're dug. */
// Four sleeves from each floor (owner): forward, right, left and back
export const ARMS = ["forward", "right", "left", "back"] as const;
export type ArmName = (typeof ARMS)[number];
// pokedTo: its pokeholes are dug off every column up to here (an arm from
// before pokeholes waited for the whole sleeve: up to `dug`); pokesLeft: the
// columns past pokedTo up to here still want theirs (dug from the far end back)
export type Arm = { dug: number; blocked: boolean; pokedTo?: number; pokesLeft?: number };
export type Arms = Record<ArmName, Arm>;
const freshArms = (): Arms => ({ forward: { dug: 0, blocked: false }, right: { dug: 0, blocked: false }, left: { dug: 0, blocked: false }, back: { dug: 0, blocked: false } });

/** The tunnel to dig next at this hub (forward, then right, then left), or null when all three are done. Pure. */
export function nextArm(arms: Arms): ArmName | null {
  return ARMS.find((a) => !sleeveFinished(arms[a]) || pokesTodo(arms[a]).length > 0) ?? null;
}

/** True when a sleeve is as long as it gets (its full length, or stopped). Pure. */
export const sleeveFinished = (a: Arm): boolean => a.blocked || a.dug >= ARM_LENGTH;

/**
 * The sleeve's columns that still want their pokeholes, far end first
 * (owner, 2026-11-28: the whole sleeve first, then the pokeholes; from the
 * far end back it ends by the room, for the next sleeve). Pure.
 */
export function pokesTodo(a: Arm): number[] {
  const from = a.pokedTo ?? a.dug;
  const out: number[] = [];
  for (let k = a.pokesLeft ?? from; k > from; k--) if (k % POKE_EVERY === 0) out.push(k);
  return out;
}

/** The arm after a stretch of its sleeve (to `dug`): the new columns' pokeholes wait. Pure. */
export function armAfterStretch(a: Arm, dug: number, blocked: boolean): Arm {
  return { dug, blocked, pokedTo: a.pokedTo ?? a.dug, pokesLeft: dug };
}

/** The arm once column `k`'s pokeholes are dug (all done: as far as its sleeve). Pure. */
export function armPokedAt(a: Arm, k: number): Arm {
  const next = { ...a, pokesLeft: k - 1 };
  return pokesTodo(next).length === 0 ? { ...a, pokedTo: a.dug, pokesLeft: a.dug } : next;
}

/** Which way an arm goes from the hub. Pure. */
export function armDirection(arm: ArmName, dir: DirectionType): DirectionType {
  return arm === "forward" ? dir : arm === "right" ? RIGHT[dir] : arm === "left" ? LEFT[dir] : RIGHT[RIGHT[dir]];
}

// The floor plan (owner's drawing): the stairs end in the middle of the
// room's back side; the room, 3 by 3, lies ahead of them, flat; the left and
// right sleeves leave from its middle line, the back sleeve runs along its
// left row beside the stairs, the forward sleeve along its right row; a
// pokehole every 3 blocks, 5 long, both sides of every sleeve; every tunnel,
// pokehole and the room 3 high; the stairs 5 high (room for stair blocks)
export const POKE_EVERY = 3;
export const POKE_LENGTH = 5;
export const POKE_HEIGHT = 3;
export const SLEEVE_HEIGHT = 3;
export const ROOM_HEIGHT = 3;

/** The room's cells as [across (+1 the stairs' right), along (0 the stairs' end)]. Pure. */
export const ROOM_CELLS: ReadonlyArray<readonly [number, number]> = [-1, 0, 1].flatMap((a) => [0, 1, 2].map((b) => [a, b] as const));

/**
 * Where a sleeve starts, in the room, as [across, along] from the hub (the
 * stairs' end): its first cell is the next one its way. Left and right from
 * the room's middle line; back along its left row, forward along its right
 * row. Pure.
 */
export function sleeveStart(arm: ArmName): readonly [number, number] {
  return arm === "left" ? [-1, 1] : arm === "right" ? [1, 1] : arm === "back" ? [-1, 0] : [1, 2];
}

// Each floor's crafting table (owner: a table on every floor, to craft down
// there instead of going home): the room's front-left corner, on no way
// through (the sleeves leave from the middle line, the back sleeve's row and
// the forward sleeve's row; the stairs go on down from the middle)
export const TABLE_CELL: readonly [number, number] = [-1, 2];

// And its furnace (owner: "we could add a furnace"): the back-right corner,
// beside the stairs' end, under the floor's sign, also on no way through
export const FURNACE_CELL: readonly [number, number] = [1, 0];

/** A room cell [across, along] for a hub the stairs arrive at going `arrive`. Pure. */
const roomCell = (hub: Vec3, arrive: DirectionType, [a, b]: readonly [number, number]): Vec3 => hub.plus(STEP[RIGHT[arrive]].scaled(a)).plus(STEP[arrive].scaled(b));

/** Where a floor's crafting table stands, for a hub the stairs arrive at going `arrive`. Pure. */
export function floorTableSpot(hub: Vec3, arrive: DirectionType): Vec3 {
  return roomCell(hub, arrive, TABLE_CELL);
}

/** Where a floor's furnace stands. Pure. */
export function floorFurnaceSpot(hub: Vec3, arrive: DirectionType): Vec3 {
  return roomCell(hub, arrive, FURNACE_CELL);
}

// Where a floor's table or furnace goes instead when its stairs turned
// through its spot: the room's forward middle, free once the old stairs on
// down from there were capped (game test: stairs turned right at the 1st
// floor dug through the furnace there)
export const MOVED_CELL: readonly [number, number] = [0, 2];

/**
 * A floor's table or furnace spot, given the cells its stairs walk through
 * (`inStairs`): the usual one, or the moved one when the stairs turned
 * through it; null when both are stairs. Pure.
 */
export function furnitureSpot(usual: Vec3, hub: Vec3, arrive: DirectionType, inStairs: (p: Vec3) => boolean): Vec3 | null {
  const free = (p: Vec3): boolean => !inStairs(p) && !inStairs(p.offset(0, 1, 0));
  if (free(usual)) return usual;
  const moved = roomCell(hub, arrive, MOVED_CELL);
  return free(moved) ? moved : null;
}

/** A sleeve's start cell for a hub (the stairs' end) the stairs arrive at going `arrive`. Pure. */
export function sleeveBase(hub: Vec3, arrive: DirectionType, arm: ArmName): Vec3 {
  const [a, b] = sleeveStart(arm);
  return hub.plus(STEP[RIGHT[arrive]].scaled(a)).plus(STEP[arrive].scaled(b));
}

/** Pokeholes off every sleeve, both sides (+1 its right, -1 its left). Pure. */
export const POKE_SIDES: ReadonlyArray<1 | -1> = [1, -1];

/** "1st floor", "2nd floor"... for a level (0 is the 1st). Pure. */
export function floorName(level: number): string {
  const n = level + 1;
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${tail} floor`;
}

// The stairs cross each floor's room flat (its middle and its front side),
// then go on down: these steps are flat
export const FLAT_STEPS = 2;
const STEPS_PER_FLOOR = LEVEL_STEP + FLAT_STEPS;

/** The stair step a hub sits on (the stairs' end at a floor): the first at the bottom of the stairs, each next floor LEVEL_STEP deeper. Pure. */
export const hubStep = (level: number): number => firstFloorAt + level * STEPS_PER_FLOOR;

/** True for a step that crosses a floor's room flat (the two after each hub). Pure. */
export function isFlatStep(i: number): boolean {
  if (i <= firstFloorAt) return false;
  const past = (i - firstFloorAt) % STEPS_PER_FLOOR;
  return past >= 1 && past <= FLAT_STEPS;
}

// The stairs' open cells above each step: the step and 3 more, 4 high (owner:
// 3 was too low, a player hit their head on the way up)
export const STAIR_HEADROOM = 4;

/** How many cells over a step's own one are dug: the stairs 5 high, their flat part across a room 3 (its ceiling). Pure. */
// Near the surface the steps are lower, so ground stays over them: the top of
// a step at least this far under the surface's feet level (game test: the
// first step outside the back door had its top in the grass, and the stairs
// opened a hole to the sky from the top down)
const UNDER_SURFACE = 3;
/**
 * How high above its feet a step is dug (4: 5 high; flat steps 3 high), and
 * lower near the surface (never under 2: 3 high). `feetY`: the step's feet
 * level; without it, the full height.
 */
export const stepHeadroom = (i: number, feetY?: number): number => {
  const full = isFlatStep(i) ? ROOM_HEIGHT - 1 : STAIR_HEADROOM;
  if (feetY === undefined) return full;
  const surface = (shelter()?.details?.["start"] as Pos | undefined)?.y;
  return surface === undefined ? full : capUnderSurface(full, surface, feetY);
};

/** A step's height kept under the surface (`surfaceY`: the surface's feet level), never under 2. Pure. */
export const capUnderSurface = (full: number, surfaceY: number, feetY: number): number => Math.max(2, Math.min(full, surfaceY - UNDER_SURFACE - feetY));

// Stairs are steps 0..the first floor: the exit cell, then one down per step
const stairsToFirstFloor = (): number => firstFloorAt + 1;
// Stairs blocked (water, lava) this deep or deeper: the mine just ends there
const SHALLOWEST_MINE = 3;

type MineRecord = { start: Pos; direction: DirectionType; stairs: number; branches: number; bottom: Vec3 | null; level: number; arms: Arms; deepest: boolean; turns: Turn[]; tried: Record<string, DirectionType[]>; seals: Pos[]; exhausted: boolean; sidesDone: number; roomsDone: number; sideFrom: number; cavePlugs: Pos[] };

/**
 * True for a block that has fallen into (or grown into) a step's walking
 * space and must be dug out: solid, natural (gravel, sand, stone, dirt),
 * never its own paving (a stair block sits in the step it paves: the review
 * found every trip dug the paving out again) nor anything else built. Pure.
 */
// Blocks it puts down itself (plugs, a block under its feet to get up a
// step, floor patches): in a step's walking space they make a step 2 high,
// which no one can walk up (owner's screenshot); dug out like fallen gravel
const OWN_FILLERS = new Set(["cobblestone", "cobbled_deepslate", "dirt", "stone", "smooth_stone"]);

export function fillsStep(b: { name: string; boundingBox: string } | null): boolean {
  return b !== null && b.boundingBox === "block" && !b.name.endsWith("_stairs") && (isNatural(b.name) || OWN_FILLERS.has(b.name));
}

/** True when water or lava touches `p` (a block there is a plug: left in). */
const holdsBackLiquid = (p: Vec3): boolean =>
  [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([x, y, z]) => /^(water|lava)$/.test(bot.blockAt(p.offset(x!, y!, z!))?.name ?? ""));

/**
 * The walking space of the steps just above `feet` on its stairs that's
 * filled (a block it put there, gravel fallen in), not holding back water:
 * what makes a step too high to walk up.
 */
function blockedStepCells(feet: Vec3): Vec3[] {
  const rec = mineRecord();
  if (!rec) return [];
  const i = nearestStairStep(feet, rec.start, rec.direction, rec.stairs, rec.turns);
  if (i === null) return [];
  const out: Vec3[] = [];
  for (let j = Math.max(1, i - 2); j <= i; j++) {
    const s = stepAt(rec.start, rec.direction, j, rec.turns);
    for (let dy = 0; dy < stepHeadroom(j, s.y); dy++) {
      const c = s.offset(0, dy, 0);
      if (fillsStep(bot.blockAt(c)) && !holdsBackLiquid(c)) out.push(c);
    }
  }
  return out;
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
    const hub = stepAt(rec.start, rec.direction, hubStep(level), rec.turns);
    if (!best || Math.abs(hub.y - pos.y) < Math.abs(best.y - pos.y)) best = hub;
  }
  return best;
}

/**
 * The floor whose tunnels are at height `y` (feet within 2 of its room's
 * floor, a dug floor only), or null on the stairs between floors.
 */
export function floorAtHeight(rec: { start: Pos; direction: DirectionType; stairs: number; level: number; turns: Turn[] }, y: number): number | null {
  for (let l = 0; l <= rec.level && hubStep(l) < rec.stairs; l++) {
    if (Math.abs(stepAt(rec.start, rec.direction, hubStep(l), rec.turns).y - Math.floor(y)) <= 2) return l;
  }
  return null;
}

/**
 * The step of its mine's stairs nearest `pos` (the way up from wherever it
 * is in its mine), or null without a mine. Pure over the record.
 */
export function nearestStairStep(pos: Pos, start: Pos, dir: DirectionType, stairs: number, turns: Turn[] = []): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < stairs; i++) {
    const s = stepAt(start, dir, i, turns);
    const d = Math.hypot(s.x - pos.x, s.y - pos.y, s.z - pos.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Work up top starting from down in its mine (fields, food, the shelter):
 * up its own stairs first, never a new way dug up through the rock (game
 * tests: to a field, and out for food, it tunnelled its own way up). Best
 * effort; nothing when it's not below its home.
 */
export async function upFromTheMine(): Promise<void> {
  const home = shelter();
  if (!home || !bot.entity || bot.entity.position.y >= home.y - 3) return;
  await climbMineStairs();
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
  if (here.y > rec.start.y - 3) return false;
  // On one of its floors (in its tunnels), the way to the stairs is that
  // floor's room, along its own tunnels (owner: from a sleeve's far end
  // under the shelter it took the nearest step in a straight line, 30
  // blocks up through solid rock, and dug its own shaft up to it)
  const floorHere = floorAtHeight(rec, here.y);
  const i = floorHere !== null ? hubStep(floorHere) : nearestStairStep(here, rec.start, rec.direction, rec.stairs, rec.turns);
  if (i === null) return false;
  // Near its stairs (an arm's length from a step), wherever they've got to
  // (review: deep levels are over 96 blocks from the top across)
  if (stepAt(rec.start, rec.direction, i, rec.turns).distanceTo(here) > ARM_LENGTH + 8) return false;
  const step = standAt(stepAt(rec.start, rec.direction, i, rec.turns));
  console.log(`Home by my mine's stairs: from step ${i} up.`);
  // Stuck on the way (a step too high to jump: game test, a block it placed
  // in its stairs left a 2-high step and every walk had no path), it puts a
  // block under itself, jumps and tries again (owner)
  let unsticks = 0;
  const MAX_UNSTICKS = 8;
  let openedWayIn = false;
  const { walk } = mineStairCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom);
  const walkSet = new Set(walk.map((c) => c.toString()));
  const onMyStairs = (): boolean => walkSet.has(bot.entity.position.floored().toString());
  // Along its tunnels and up its stairs, never a new way dug: digging is
  // made too dear to choose (only if there's no other way at all)
  const walkNoDig = (g: InstanceType<typeof pf.goals.GoalNear>) => pathing.withRules({ digCost: 100 }, () => goTo(g));
  // Its stairs put back as planned when the way up is broken (owner), once
  let restored = false;
  while (!(await walkNoDig(new pf.goals.GoalNear(step.x, step.y, step.z, 1))).ok) {
    if (isCommandCancelled()) return false;
    if (!restored) {
      restored = true;
      if (await restoreStairsUp()) return true;
      continue;
    }
    // Off its stairs (in a cave beside them): a way in through their wall,
    // once; building itself up out there does nothing (game test: it
    // stacked blocks in a flooded cave for minutes, its sealed stairs
    // beside it, until drowned zombies killed it)
    if (!onMyStairs()) {
      if (openedWayIn || !(await openWayIn(stepAt(rec.start, rec.direction, i, rec.turns), dirAt(rec.direction, i, rec.turns)))) return false;
      openedWayIn = true;
      continue;
    }
    if (unsticks >= MAX_UNSTICKS || !(await unstickOnStairs())) return false;
    unsticks++;
  }
  // Up them a stretch at a time (each leg short, so it keeps to the stairs)
  for (let j = Math.max(0, i - 8); ; ) {
    if (isCommandCancelled()) return false;
    const s = standAt(stepAt(rec.start, rec.direction, j, rec.turns));
    if (!(await walkNoDig(new pf.goals.GoalNear(s.x, s.y, s.z, 1))).ok) {
      if (!restored) {
        restored = true;
        if (await restoreStairsUp()) return true;
        continue;
      }
      if (unsticks >= MAX_UNSTICKS || !(await unstickOnStairs())) return false;
      unsticks++;
      continue;
    }
    if (j === 0) return true;
    j = Math.max(0, j - 8);
  }
}

/**
 * Its stairs put back as planned, from where it is up to its shelter
 * (owner: "fix the stairs repair from inside the mine; they should be as
 * planned"; game test: creepers had blown its stairs apart, no way home,
 * and it pillared up a shaft beside them instead): step by step upward,
 * each step's walking space cleared of whatever fills it (fallen gravel,
 * blocks it put down when stuck), its floor, walls and roof filled, then up
 * onto it. True when it got to the top.
 */
export async function restoreStairsUp(): Promise<boolean> {
  const rec = mineRecord();
  if (!rec || !bot.entity) return false;
  const here = bot.entity.position;
  const floorHere = floorAtHeight(rec, here.y);
  const i0 = floorHere !== null ? hubStep(floorHere) : nearestStairStep(here, rec.start, rec.direction, rec.stairs, rec.turns);
  if (i0 === null || i0 < 1) return false;
  const { walk } = mineStairCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom);
  const tunnels = hubTunnelCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom);
  const walkSet = new Set(walk.map((c) => c.toString()));
  const keepClear = (p: Vec3): boolean => walkSet.has(p.toString()) || tunnels.has(p.toString());
  report(`My stairs home are broken; putting them back as planned, from step ${i0} up.`);
  await stockStairsFillers(allShellHoles(rec, walkSet, tunnels).length);
  const { breakBlock } = await import("../core/primitives");
  const step = (i: number): Vec3 => stepAt(rec.start, rec.direction, i, rec.turns);
  // A step's walking space emptied, top down (gravel over it falls in again: a few goes)
  const clearStep = async (i: number): Promise<number> => {
    const st = step(i);
    let n = 0;
    for (let dy = stepHeadroom(i, st.y) - 1; dy >= 0; dy--) {
      const c = st.offset(0, dy, 0);
      for (let k = 0; k < 8 && !isCommandCancelled(); k++) {
        const b = bot.blockAt(c);
        if (!b || b.boundingBox !== "block" || /_stairs$|torch|_door$|_sign$/.test(b.name) || holdsBackLiquid(c)) break;
        if (!(await breakBlock(c, { allowWithoutHarvest: true })).ok) break;
        n++;
      }
    }
    return n;
  };
  let cleared = await clearStep(i0);
  let filled = 0;
  const start = standAt(step(i0));
  if (!(await goTo(new pf.goals.GoalNear(start.x, start.y, start.z, 1))).ok) {
    console.log(`Mine: can't get onto step ${i0} of my stairs to put them back.`);
    return false;
  }
  for (let i = i0; i >= 1; i--) {
    if (isCommandCancelled()) return false;
    filled += await fillFromSolid(shellHoles(rec, i, walkSet, tunnels), keepClear);
    // The next step up: its floor first (it can't be stood on without one),
    // then its walking space emptied, then up onto it
    if (i - 1 >= 1) filled += await fillFromSolid(shellHoles(rec, i - 1, walkSet, tunnels).filter((h) => h.y < step(i - 1).y), keepClear);
    cleared += await clearStep(i - 1);
    const up = standAt(step(i - 1));
    let moved = await pathing.withRules({ digCost: 100 }, () => goTo(new pf.goals.GoalBlock(up.x, up.y, up.z)));
    if (!moved.ok) moved = await goTo(new pf.goals.GoalNear(up.x, up.y, up.z, 1));
    if (!moved.ok) {
      const at = (dy: number): string => bot.blockAt(up.offset(0, dy, 0))?.name ?? "?";
      console.log(`Mine: putting my stairs back, can't get onto step ${i - 1} at ${up} (${moved.detail ?? moved.reason}; floor ${at(-1)}, feet ${at(0)}, head ${at(1)}; I'm at ${bot.entity.position.floored()}).`);
      return false;
    }
  }
  console.log(`Mine: my stairs put back from step ${i0} up: ${cleared} blocks cleared out of them, ${filled} holes in their floor, walls and roof filled.`);
  return true;
}

/**
 * A way into its stairs from beside them: the wall of step `s` on the side
 * nearer the bot, 2 high, dug out (it's mended on the next trip down). True
 * when it's open.
 */
async function openWayIn(s: Vec3, way: DirectionType): Promise<boolean> {
  const here = bot.entity.position;
  const sides = [STEP[armDirection("right", way)], STEP[armDirection("left", way)]];
  const side = sides.sort((a, b) => s.plus(a).distanceTo(here) - s.plus(b).distanceTo(here))[0]!;
  const cells = [s.plus(side), s.plus(side).offset(0, 1, 0)];
  if (!(await goTo(new pf.goals.GoalNear(cells[0]!.x, cells[0]!.y, cells[0]!.z, 2))).ok) return false;
  const { breakBlock } = await import("../core/primitives");
  for (const c of cells) {
    if (bot.blockAt(c)?.boundingBox !== "block") continue;
    if (!(await breakBlock(c, { allowWithoutHarvest: true })).ok) return false;
  }
  console.log(`Off my stairs: opened a way in at ${cells[0]} to climb home.`);
  return true;
}

/**
 * Blocks to put under itself, in the order tried: full blocks first (game
 * test: a stair block "didn't go in" under it mid-jump), a stair block last.
 */
const UNSTICK_BLOCKS = ["cobblestone", "cobbled_deepslate", "dirt", "stone", "cobblestone_stairs"];

/**
 * Stuck on its stairs, like a player: the block over its head dug out if
 * it's natural, then a block put under its feet with a jump, a block up.
 * True when it got up.
 */
export async function unstickOnStairs(): Promise<boolean> {
  const feet = bot.entity.position.floored();
  const { breakBlock, pillarUp } = await import("../core/primitives");
  // A block in the steps just above (one it put there, gravel): dug out,
  // so the stairs are steps again, rather than built up more (owner)
  const filled = blockedStepCells(feet);
  if (filled.length > 0) {
    let dug = 0;
    for (const c of filled.reverse()) if ((await breakBlock(c, { allowWithoutHarvest: true })).ok) dug++;
    console.log(`Stuck on my stairs at ${feet}: dug out ${dug} block${dug === 1 ? "" : "s"} filling the steps above.`);
    if (dug > 0) return true;
  }
  const over = feet.offset(0, 2, 0);
  const b = bot.blockAt(over);
  if (b && b.boundingBox === "block") {
    const { isNatural, isProtected } = await import("../core/movements");
    if (!isNatural(b.name) || isProtected(over)) return false;
    if (!(await breakBlock(over)).ok) return false;
  }
  // Each kind it carries in turn until one goes in
  for (const block of UNSTICK_BLOCKS.filter((n) => carried([n]) > 0)) {
    if (isCommandCancelled()) return false;
    const up = await pillarUp(block);
    if (up.ok) {
      console.log(`Stuck on my stairs at ${feet}: put ${block.replace(/_/g, " ")} under me and got up a block.`);
      return true;
    }
    console.log(`Stuck on my stairs at ${feet}: ${block.replace(/_/g, " ")} didn't go under me (${describeFailure(up)}).`);
  }
  return false;
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
    const hub = stepAt(rec.start, rec.direction, hubStep(level), rec.turns);
    const arrive = dirAt(rec.direction, hubStep(level), rec.turns);
    const R = STEP[RIGHT[arrive]];
    // The floor's room and where its four sleeves leave it
    for (const [a, b] of ROOM_CELLS) for (const dy of [0, 1]) out.push(hub.plus(R.scaled(a)).plus(STEP[arrive].scaled(b)).offset(0, dy, 0));
    for (const arm of ARMS) {
      const cell = sleeveBase(hub, arrive, arm).plus(STEP[armDirection(arm, arrive)].scaled(2));
      out.push(cell, cell.offset(0, 1, 0));
    }
  }
  return out;
}

/** The mine record (stairs maybe not finished): stairs dug so far, branches done, the bottom once finished. */
function mineRecord(): MineRecord | null {
  const dim = currentDimension();
  const mine = getPlaces("mine").find((m) => m.name === MINE_NAME && m.dimension === dim);
  if (!mine) {
    firstFloorAt = MINE_DEPTH;
    return null;
  }
  const d = (mine.details ?? {}) as { direction?: DirectionType; stairs?: number; depth?: number; branches?: number; endsAt?: Pos; done?: boolean; level?: number; arms?: Arms; deepest?: boolean; turns?: Turn[]; tried?: Record<string, DirectionType[]>; seals?: Pos[]; cavePlugs?: Pos[]; exhausted?: boolean; sidesDone?: number; roomsDone?: number; sideFrom?: number };
  if (!d.direction) return null;
  // Its first floor where it was dug (10 before the owner's 20)
  firstFloorAt = d.depth ?? MINE_DEPTH;
  // Older records (one dig of steps 0..10, saved when done) are finished
  const stairs = d.stairs ?? (d.depth === 10 ? 11 : 0);
  let done = d.done ?? stairs >= stairsToFirstFloor();
  // Ended above the first floor by water, lava or a drop with a way to turn
  // still untried there (older records): open again, the stairs turn aside
  const untouched = !d.arms || Object.values(d.arms).every((a) => !a || a.dug === 0);
  if (done && stairs < stairsToFirstFloor() && (d.level ?? 0) === 0 && untouched && earlyTurn(d.direction, d.turns ?? [], d.tried ?? {}, stairs) !== null) done = false;
  return {
    start: { x: mine.x, y: mine.y, z: mine.z },
    direction: d.direction,
    stairs,
    branches: d.branches ?? 0,
    bottom: done && d.endsAt ? new Vec3(d.endsAt.x, d.endsAt.y, d.endsAt.z) : null,
    level: d.level ?? 0,
    // An older mine (main tunnel with side branches): its main tunnel is the
    // start of the forward tunnel
    arms: d.arms ? { ...freshArms(), ...d.arms } : { ...freshArms(), forward: { dug: Math.min(ARM_LENGTH, (d.branches ?? 0) * BRANCH_EVERY), blocked: false } },
    deepest: d.deepest ?? false,
    turns: d.turns ?? [],
    tried: d.tried ?? {},
    seals: d.seals ?? [],
    cavePlugs: d.cavePlugs ?? [],
    exhausted: d.exhausted ?? false,
    sidesDone: d.sidesDone ?? 0,
    roomsDone: d.roomsDone ?? -1,
    // The first floor with its room beside the stairs (owner, later): the
    // floors already dug keep the room round the stairs
    sideFrom: d.sideFrom ?? (d.roomsDone ?? -1) + 1,
  };
}

/** Whether a floor's room is beside the stairs (not round them). Pure. */
export const roomBeside = (level: number, sideFrom: number): boolean => level >= sideFrom;

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
    setNoDig([], "mine");
    return;
  }
  const { keep, walk } = mineStairCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom);
  // The ground over the shallow stairs too, up to over the surface (a walk
  // home dug down into them from the grass): only protected, never "mended"
  const surface = (shelter()?.details?.["start"] as Pos | undefined)?.y ?? rec.start.y + 6;
  const { overburden } = await import("../actions/building");
  const shallow = walk.filter((c) => c.y > stepAt(rec.start, rec.direction, hubStep(0), rec.turns).y);
  const above = overburden(shallow, keep, surface + 3);
  // And the ground beside them, GROUND_BAND either side: never dug by a walk
  // (owner: shortcuts dug from the grass into the stairs, 2 blocks off them;
  // the way in is through the shelter)
  setNoDig(mineGroundBand(shallow, surface + 3), "mine");
  // Its caps over stairs it gave up (blocked going down): never dug through
  const seals = rec.seals.map((p) => new Vec3(p.x, p.y, p.z));
  protectCells([...keep, ...above, ...seals], "mine");
  // Its floors' rooms, sleeves and pokeholes are its passages too: no block
  // is put down in them on a walk (owner: dirt and cobblestone left standing
  // in the tunnels, footholds from digging the 3-high pokeholes)
  const floors: Vec3[] = [];
  for (let l = 0; l <= rec.level && hubStep(l) < rec.stairs; l++) {
    floors.push(...floorCells(stepAt(rec.start, rec.direction, hubStep(l), rec.turns), dirAt(rec.direction, hubStep(l), rec.turns), l, roomBeside(l, rec.sideFrom)));
  }
  setOwnPassages([...walk, ...floors], "mine");
}

// How far either side of its shallow stairs the ground is never dug by a walk
export const GROUND_BAND = 3;

/**
 * The ground beside and over its shallow stairs (`open`: their walking
 * cells), GROUND_BAND either side, from each step's level up to `top`, but
 * the stairs' own open cells. Pure.
 */
export function mineGroundBand(open: Array<{ x: number; y: number; z: number }>, top: number): Vec3[] {
  const openSet = new Set(open.map((c) => `${c.x},${c.y},${c.z}`));
  // The lowest step under each column of the band
  const lowest = new Map<string, number>();
  for (const c of open) {
    for (let dx = -GROUND_BAND; dx <= GROUND_BAND; dx++) {
      for (let dz = -GROUND_BAND; dz <= GROUND_BAND; dz++) {
        const k = `${c.x + dx},${c.z + dz}`;
        if (!lowest.has(k) || lowest.get(k)! > c.y) lowest.set(k, c.y);
      }
    }
  }
  const cells: Vec3[] = [];
  for (const [k, y0] of lowest) {
    const [x, z] = k.split(",").map(Number) as [number, number];
    for (let y = y0; y <= top; y++) if (!openSet.has(`${x},${y},${z}`)) cells.push(new Vec3(x, y, z));
  }
  return cells;
}

/** The stairs' protected cells (floors, roofs, side walls but the hubs') and walking cells (each step's open space). Pure. */
export function mineStairCells(start: Pos, dir: DirectionType, stairs: number, level: number, turns: Turn[] = [], sideFrom = 0): { keep: Vec3[]; walk: Vec3[] } {
  const keep: Vec3[] = [];
  const walk: Vec3[] = [];
  const tunnels = hubTunnelCells(start, dir, stairs, level, turns, sideFrom);
  for (let i = 0; i < stairs; i++) {
    const s = stepAt(start, dir, i, turns);
    for (let dy = 0; dy <= stepHeadroom(i, s.y); dy++) walk.push(s.offset(0, dy, 0));
    keep.push(...stepShell(start, dir, i, level, turns).filter((c) => !tunnels.has(c.toString())));
  }
  return { keep, walk };
}

/**
 * The walking space of the tunnels from its hubs (forward, right, left, 2
 * high, as long as a tunnel gets): never closed up as part of the stairs'
 * shell, where the stairs run under them. Pure.
 */
export function hubTunnelCells(start: Pos, dir: DirectionType, stairs: number, level: number, turns: Turn[] = [], sideFrom = 0): Set<string> {
  const out = new Set<string>();
  for (let l = 0; l <= level; l++) {
    const h = hubStep(l);
    if (h >= stairs) break;
    for (const c of floorCells(stepAt(start, dir, h, turns), dirAt(dir, h, turns), l, roomBeside(l, sideFrom))) out.add(c.toString());
  }
  return out;
}

/**
 * Its floors' planned pokehole cells (every floor down to `level`), as
 * Vec3 strings. Open, one is its own digging, never a cave: a pass cut off
 * before its record was saved digs that stretch again (game test: the 3rd
 * floor's pokeholes, dug at 16:39 and the pass cut off by an ore it saw,
 * were taken for caves on the next pass, plugged, dug through and plugged
 * again). Pure.
 */
export function pokePlanCells(start: Pos, dir: DirectionType, stairs: number, level: number, turns: Turn[] = [], sideFrom = 0): Set<string> {
  const out = new Set<string>();
  for (let l = 0; l <= level; l++) {
    const h = hubStep(l);
    if (h >= stairs) break;
    const hub = stepAt(start, dir, h, turns);
    const arrive = dirAt(dir, h, turns);
    const side = roomBeside(l, sideFrom);
    const noPokes = new Set(floorCells(hub, arrive, l, side, undefined, false).map((c) => c.toString()));
    for (const c of floorCells(hub, arrive, l, side)) if (!noPokes.has(c.toString())) out.add(c.toString());
  }
  return out;
}

/**
 * Every open cell of a floor (owner's layout): its 3 by 3 room, 3 high, its
 * four sleeves (2 high, ARM_LENGTH long) and their pokeholes (1 wide,
 * POKE_HEIGHT high, POKE_LENGTH long, every POKE_EVERY blocks). Pure.
 */
export function floorCells(hub: Vec3, arrive: DirectionType, _level = 0, _side = true, dugTo?: Partial<Record<ArmName, number>>, pokes = true): Vec3[] {
  const out: Vec3[] = [];
  const R = STEP[RIGHT[arrive]];
  const F = STEP[arrive];
  for (const [a, b] of ROOM_CELLS) for (let dy = 0; dy < ROOM_HEIGHT; dy++) out.push(hub.plus(R.scaled(a)).plus(F.scaled(b)).offset(0, dy, 0));
  for (const arm of ARMS) {
    const way = STEP[armDirection(arm, arrive)];
    const across = STEP[RIGHT[armDirection(arm, arrive)]];
    const base = sleeveBase(hub, arrive, arm);
    const last = dugTo?.[arm] ?? ARM_LENGTH;
    for (let k = 1; k <= last; k++) {
      const cell = base.plus(way.scaled(k));
      for (let dy = 0; dy < SLEEVE_HEIGHT; dy++) out.push(cell.offset(0, dy, 0));
      if (!pokes || k % POKE_EVERY !== 0) continue;
      for (const sd of POKE_SIDES) {
        for (let p = 1; p <= POKE_LENGTH; p++) for (let dy = 0; dy < POKE_HEIGHT; dy++) out.push(cell.plus(across.scaled(sd * p)).offset(0, dy, 0));
      }
    }
  }
  return out;
}

/**
 * One step's floor, roof and side walls (none for the doorway, no side
 * walls at a hub). The roof too, all the way down (owner: seal the stairs
 * off from the caves they cross; mobs came in from a dripstone cave and it
 * died there three times), but never where a hub's tunnel runs over them.
 * Pure.
 */
function stepShell(start: Pos, dir: DirectionType, i: number, level: number, turns: Turn[] = []): Vec3[] {
  if (i === 0) return [];
  const s = stepAt(start, dir, i, turns);
  const way = dirAt(dir, i, turns);
  const cells = [s.offset(0, -1, 0), s.offset(0, STAIR_HEADROOM + 1, 0)];
  // A step lowered near the surface: its real roof (the ground over it) too
  const low = stepHeadroom(i, s.y);
  if (low < STAIR_HEADROOM) cells.push(s.offset(0, low + 1, 0));
  const hubs = new Set(Array.from({ length: level + 1 }, (_, l) => hubStep(l)));
  if (hubs.has(i) || isFlatStep(i)) return cells;
  for (const side of [STEP[armDirection("right", way)], STEP[armDirection("left", way)]]) {
    for (let dy = -1; dy <= STAIR_HEADROOM; dy++) cells.push(s.plus(side).offset(0, dy, 0));
  }
  return cells;
}

// Slots in use (of 36) that make a bag heavy enough to take home after a trip
const HEAVY_SLOTS = 24;

/**
 * Its haul put away at home (owner: it must go to its shelter and keep its
 * things there; it died in its mine carrying 1022): with the bag this full,
 * out of the mine, into the shelter, and everything but its working kit
 * (tools, food, torches, some stone, coal and dirt) in its chests.
 */
export async function haulHomeIfHeavy(): Promise<void> {
  if (bot.inventory.items().length < HEAVY_SLOTS || isCommandCancelled()) return;
  console.log(`Mine: my bag is heavy (${bot.inventory.items().length} slots); taking it home.`);
  await upFromTheMine();
  const { putAwayHaul } = await import("./homeChores");
  await putAwayHaul();
}

/** A cell as the outside check sees it (null: not loaded). */
export type SealLook = { solid: boolean; liquid: boolean; sky: boolean } | null;
const DIRS6 = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

/**
 * Where its mine opens to the outside (owner: a canyon cut into the first
 * floor let the night's mobs in): the open cells right outside the mine's
 * own space (`open`) from which open air reaches the sky (searched up to
 * `limit` cells; a cave that goes nowhere near the sky stays open, owner).
 * `kept`: its other passages (the shelter), never searched through. Pure
 * over `look`.
 */
export function outsideOpenings(open: Vec3[], look: (p: Vec3) => SealLook, kept: (p: Vec3) => boolean = () => false, limit = 1500): Vec3[] {
  const key = (p: Vec3): string => `${p.x},${p.y},${p.z}`;
  const openSet = new Set(open.map(key));
  const passable = (p: Vec3): boolean => {
    if (openSet.has(key(p)) || kept(p)) return false;
    const c = look(p);
    return c !== null && !c.solid && !c.liquid;
  };
  const reachesSky = new Map<string, boolean>();
  const seen = new Set<string>();
  const out: Vec3[] = [];
  for (const c of open) {
    for (const d of DIRS6) {
      const n = c.plus(d);
      const k = key(n);
      if (seen.has(k)) continue;
      seen.add(k);
      if (!passable(n)) continue;
      let sky = reachesSky.get(k);
      if (sky === undefined) {
        sky = false;
        const region = new Set([k]);
        const queue = [n];
        for (let i = 0; i < queue.length && region.size <= limit; i++) {
          const p = queue[i]!;
          if (look(p)?.sky) {
            sky = true;
            break;
          }
          for (const e of DIRS6) {
            const q = p.plus(e);
            const kq = key(q);
            if (!region.has(kq) && passable(q)) {
              region.add(kq);
              queue.push(q);
            }
          }
        }
        for (const r of region) reachesSky.set(r, sky);
      }
      if (sky) out.push(n);
    }
  }
  return out;
}

// Ways in from outside sealed in one go, at most (the rest next time; owner:
// 48 left a canyon half open)
const SEALS_PER_RUN = 400;
// Time a sealing pass may take (the rest next stretch)
const SEAL_TIME_MS = 4 * 60_000;
// How far from it the floors are gone over (the whole floor, its sleeves 50 long)
const LOOK_AFTER_RANGE = 96;

/**
 * Its mine's floors closed off from the outside (owner): every opening from
 * a floor's room, sleeves and pokeholes, or its stairs, into open air that
 * reaches the sky (a canyon, a ravine) blocked with cobblestone. Caves that
 * stay underground are left open. Only the floors near it (loaded).
 */
export async function sealMineFromOutside(): Promise<void> {
  const rec = mineRecord();
  if (!rec || !bot.entity) return;
  const { walk } = mineStairCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom);
  const open: Vec3[] = [...walk, ...floorsAsDug(rec)];
  // Only what's dug out already, and dry
  const near = open.filter(openDryNear);
  const look = (p: Vec3): SealLook => {
    const b = bot.blockAt(p);
    if (!b) return null;
    const liquid = b.name === "water" || b.name === "lava";
    const sky = !liquid && b.boundingBox === "empty" && ((b as unknown as { skyLight?: number }).skyLight === 15 || seesSkyCheap(p));
    return { solid: b.boundingBox === "block", liquid, sky };
  };
  // The shelter's own space (its stairs lead out): never searched or sealed
  const { inOwnPassage } = await import("../core/movements");
  const openKeys = new Set(open.map((c) => c.toString()));
  const kept = (p: Vec3): boolean => inOwnPassage(p) && !openKeys.has(p.toString());
  // A canyon or a hole to the sky is close by: a cave that reaches the
  // surface only far off is a cave, left open (owner: caverns stay open; the
  // wide search had it walking about caves and getting stuck sealing them)
  const holes = outsideOpenings(near, look, kept, 600).slice(0, SEALS_PER_RUN);
  if (holes.length === 0) return;
  // Said once as running commentary (the newest replaces it), never a report
  // to the owner after every stretch (owner: chat full of these)
  console.log(`Mine: open to the outside in ${holes.length} place${holes.length === 1 ? "" : "s"}; blocking with cobblestone.`);
  chatter(`Blocking where my mine opens to the outside (${holes.length}).`, "sealing");
  const { ensureBlock, STONE_FILLERS } = await import("../actions/digging");
  const keepClear = (p: Vec3): boolean => openKeys.has(p.toString());
  // From inside its mine, never out in the canyon (game test: it walked out
  // to a hole, fell into the water at the canyon's bottom and swam there for
  // 20 minutes): standing in the mine's cell beside the hole, in reach
  const nearKeys = new Set(near.map((c) => c.toString()));
  // Where to stand: the floor of the mine's own column beside the hole (game
  // test: it aimed at the empty top of its 5-high stairs, couldn't stand
  // there, and sealed 4 of 110 in 4 minutes)
  const floorOf = (c: Vec3): Vec3 => {
    let f = c;
    while (nearKeys.has(f.offset(0, -1, 0).toString())) f = f.offset(0, -1, 0);
    return f;
  };
  const inside = (h: Vec3): Vec3 | undefined => DIRS6.map((d) => h.plus(d)).find((c) => nearKeys.has(c.toString()));
  const until = Date.now() + SEAL_TIME_MS;
  let sealed = 0;
  let missed = 0;
  const unreachable = new Set<string>();
  // Nearest first, so it works along rather than back and forth
  holes.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
  for (const h of holes) {
    if (isCommandCancelled() || Date.now() > until || hurtInTheMine() || missed >= 3) break;
    const from = inside(h);
    if (!from) continue;
    const stand = floorOf(from);
    if (unreachable.has(stand.toString())) continue;
    if (bot.entity.position.distanceTo(h) > 4 && !(await goToStep(stand)).ok) {
      unreachable.add(stand.toString());
      missed++;
      continue;
    }
    if (bot.entity.position.distanceTo(h) > 5) continue;
    if (await ensureBlock(h, keepClear, STONE_FILLERS)) {
      sealed++;
      missed = 0;
    }
  }
  console.log(`Mine: sealed ${sealed} of ${holes.length} openings to the outside.`);
}

/**
 * Its floors' cells as far as it has dug them (rooms, sleeves to their dug
 * length, their pokeholes), never the plan beyond (game test: a planned
 * sleeve over a lake counted as its mine, and it walked into the lake to
 * "seal" it). The floors above the deepest were dug out in full.
 */
function floorsAsDug(rec: MineRecord): Vec3[] {
  const out: Vec3[] = [];
  for (let l = 0; l <= rec.level && hubStep(l) < rec.stairs; l++) {
    const h = hubStep(l);
    const hub = stepAt(rec.start, rec.direction, h, rec.turns);
    const arrive = dirAt(rec.direction, h, rec.turns);
    // This floor's record, or (a floor above, its record gone) as far as each
    // sleeve's open, dry floor really runs (game test: the first floor's
    // planned right sleeve ran through a lake and a cave, and every sealing
    // pass walked out there)
    const dugTo = l === rec.level
      ? Object.fromEntries(ARMS.map((a) => [a, rec.arms[a].dug]))
      : Object.fromEntries(ARMS.map((a) => [a, openRun(sleeveBase(hub, arrive, a), armDirection(a, arrive))]));
    out.push(...floorCells(hub, arrive, l, true, dugTo));
  }
  return out;
}

/**
 * The cells of its pokeholes as really dug: each pokehole from its sleeve
 * out, up to its first column that isn't open (one that stopped at a cave
 * ends at its plug: the cave beyond isn't the pokehole). `open`: an open
 * cell at a column's feet.
 */
function pokeCellsAsDug(rec: MineRecord, open: (p: Pos) => boolean): Vec3[] {
  const out: Vec3[] = [];
  for (let l = 0; l <= rec.level && hubStep(l) < rec.stairs; l++) {
    const h = hubStep(l);
    const hub = stepAt(rec.start, rec.direction, h, rec.turns);
    const arrive = dirAt(rec.direction, h, rec.turns);
    for (const arm of ARMS) {
      const way = armDirection(arm, arrive);
      const base = sleeveBase(hub, arrive, arm);
      const last = l === rec.level ? rec.arms[arm].dug : openRun(base, way);
      for (let k = POKE_EVERY; k <= last; k += POKE_EVERY) {
        const cell = base.plus(STEP[way].scaled(k));
        for (const sd of POKE_SIDES) {
          const across = STEP[sd === 1 ? RIGHT[way] : LEFT[way]];
          for (let q = 1; q <= POKE_LENGTH; q++) {
            const c = cell.plus(across.scaled(q));
            if (!open(c)) break;
            for (let dy = 0; dy < POKE_HEIGHT; dy++) out.push(c.offset(0, dy, 0));
          }
        }
      }
    }
  }
  return out;
}

const SIX: readonly Pos[] = [
  { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
];

/**
 * Where tunnel cells (`cells`, the open ones) touch open cave: any open
 * neighbour (tip, sides, roof, floor) that isn't one of its own dug cells
 * (`own`), nor water, lava or a torch. Pure over `open`.
 */
export function caveOpenings(cells: Pos[], own: Set<string>, open: (p: Pos) => boolean): Pos[] {
  const key = (p: Pos): string => `(${p.x}, ${p.y}, ${p.z})`;
  const seen = new Set<string>();
  const out: Pos[] = [];
  for (const c of cells) {
    if (!open(c)) continue; // not dug (yet): nothing open there
    for (const d of SIX) {
      const n = { x: c.x + d.x, y: c.y + d.y, z: c.z + d.z };
      const k = key(n);
      if (seen.has(k) || own.has(k)) continue;
      seen.add(k);
      if (open(n)) out.push(n);
    }
  }
  return out;
}

// An air pocket this big or more is a cave to seal; smaller ones are left
// open (owner, 2026-11-28: "small air pockets aren't the problem, mobs won't
// spawn there; under 100 air blocks")
export const SMALL_POCKET = 100;

/**
 * The cave openings to plug: those whose air pocket (the air joined to them,
 * not its own tunnel cells, `own`) has SMALL_POCKET cells or more. A pocket
 * that meets water or lava, or runs out of what it knows (unloaded), counts
 * as big. Openings into one pocket share its size. Pure over `nameAt`.
 */
export function openingsToPlug(holes: Pos[], own: Set<string>, nameAt: (p: Pos) => string | null, limit = SMALL_POCKET): Pos[] {
  return airPockets(holes, own, nameAt, limit).filter((p) => p.big).flatMap((p) => p.holes);
}

/** An air pocket behind cave openings: its openings, its air cells (all of them when small) and whether it's big. */
export type AirPocket = { holes: Pos[]; cells: Pos[]; big: boolean };

/**
 * The air pockets behind these openings (see openingsToPlug): the air
 * joined to each opening, not its own tunnel cells (`own`), counted up to
 * `limit`. Openings into one pocket share it. Pure over `nameAt`.
 */
export function airPockets(holes: Pos[], own: Set<string>, nameAt: (p: Pos) => string | null, limit = SMALL_POCKET): AirPocket[] {
  const key = (p: Pos): string => `(${p.x}, ${p.y}, ${p.z})`;
  const done = new Set<string>();
  const out: AirPocket[] = [];
  for (const h of holes) {
    if (done.has(key(h))) continue;
    const seen = new Map<string, Pos>([[key(h), h]]);
    const queue: Pos[] = [h];
    let big = false;
    while (queue.length > 0 && !big) {
      const c = queue.shift()!;
      for (const d of SIX) {
        const n = { x: c.x + d.x, y: c.y + d.y, z: c.z + d.z };
        const k = key(n);
        if (seen.has(k) || own.has(k)) continue;
        const name = nameAt(n);
        if (name === null || /water|lava/.test(name)) {
          big = true;
          break;
        }
        if (!/^(air|cave_air)$/.test(name) && !/torch/.test(name)) continue;
        seen.set(k, n);
        if (seen.size >= limit) {
          big = true;
          break;
        }
        queue.push(n);
      }
    }
    const mine = holes.filter((o) => seen.has(key(o)));
    for (const o of mine) done.add(key(o));
    done.add(key(h));
    out.push({ holes: mine.length > 0 ? mine : [h], cells: [...seen.values()], big });
  }
  return out;
}

// Small pockets it left open lately: the ore in their walls is mined next
let pocketsLeft: Pos[] = [];

/** The openings to plug, live: small pockets left open (logged). */
function bigCaveOpenings(holes: Pos[], own: Set<string>): Pos[] {
  if (holes.length === 0) return holes;
  const pockets = airPockets(holes, own, (p) => bot.blockAt(new Vec3(p.x, p.y, p.z))?.name ?? null);
  const small = pockets.filter((p) => !p.big);
  if (small.length > 0) {
    console.log(`Mine: ${small.reduce((n, p) => n + p.holes.length, 0)} opening(s) into a small air pocket (under ${SMALL_POCKET} blocks) left open.`);
    // Its ore is mined next (owner: "if there is the ore, mine it")
    pocketsLeft.push(...small.flatMap((p) => p.cells));
  }
  return pockets.filter((p) => p.big).flatMap((p) => p.holes);
}

// Ore blocks taken out of one pocket's walls at most (the vein behind them included)
const POCKET_ORE_MAX = 24;

/**
 * The ore in the walls of the small air pockets it left open (owner,
 * 2026-11-28: the coal in a pocket's roof was left as it dug on): each
 * walked to (into the pocket: under 100 blocks, nothing spawns there) and
 * mined, with the vein behind it. How many blocks.
 */
async function minePocketsLeft(): Promise<number> {
  if (pocketsLeft.length === 0 || !bot.entity) return 0;
  const cells = [...new Map(pocketsLeft.map((p) => [`${p.x},${p.y},${p.z}`, new Vec3(p.x, p.y, p.z)])).values()];
  pocketsLeft = [];
  const nameAt = (p: Vec3): string | null => bot.blockAt(p)?.name ?? null;
  const pickaxe = bestPickaxe();
  const ores = veinFrom(cells, nameAt, () => true, POCKET_ORE_MAX).filter((o) => {
    const name = nameAt(o) ?? "";
    return pickaxe !== null && catalog().canHarvest(name, pickaxe) && !oreCapped(name);
  });
  if (ores.length === 0) return 0;
  const { breakBlock } = await import("../core/primitives");
  const { pickupNearbyItems } = await import("../actions/pickup");
  let got = 0;
  for (const o of ores) {
    if (isCommandCancelled() || hurtInTheMine() || bot.inventory.emptySlotCount() === 0) break;
    if (!/_ore$/.test(nameAt(o) ?? "")) continue;
    if (!withinReach(o) && !(await whileGathering(() => goTo(new pf.goals.GoalNear(o.x, o.y, o.z, 2)))).ok) continue;
    if ((await breakBlock(o)).ok) {
      got++;
      minedOre.add(o.toString());
    }
  }
  if (got > 0) {
    await pickupNearbyItems(bot, 4);
    console.log(`Mine: mined ${got} ore in the small air pocket${got === 1 ? "" : "s"} I left open.`);
  }
  return got;
}

/**
 * Its pokeholes sealed off from the caves they opened into (owner: a
 * pokehole that reveals a cavern has its tip sealed; the tip was never
 * checked, only the face ahead before each next column), here `cells` or,
 * with none given, every pokehole it has dug. How many openings it plugged.
 */
// After a pass that plugged nothing, the next waits this long (game test:
// three passes in 90 s, two of them plugging nothing)
const SEAL_RETRY_MS = 5 * 60_000;
let sealIdleUntil = 0;

async function sealPokeCaves(cells?: Vec3[], alsoOwn: Vec3[] = []): Promise<number> {
  const rec = mineRecord();
  if (!rec || !bot.entity) return 0;
  if (!cells && Date.now() < sealIdleUntil) return 0;
  const own = new Set<string>([...floorsAsDug(rec), ...mineStairCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom).walk].map((c) => c.toString()));
  const open = (p: Pos): boolean => {
    const b = bot.blockAt(new Vec3(p.x, p.y, p.z));
    return b !== null && b.boundingBox === "empty" && !/water|lava|torch/.test(b.name);
  };
  const near = (p: Pos): boolean => bot.entity.position.distanceTo(new Vec3(p.x, p.y, p.z)) <= LOOK_AFTER_RANGE;
  const pokes = (cells ?? pokeCellsAsDug(rec, open)).filter(near);
  // Its pokeholes' own cells are never openings, however far its record has
  // got (game test: right after digging one, its record didn't have that
  // stretch yet, and it filled the new pokehole itself with cobblestone)
  for (const c of [...(cells ?? pokeCellsAsDug(rec, open)), ...alsoOwn]) own.add(c.toString());
  for (const k of minedOre) own.add(k);
  const holes = bigCaveOpenings(caveOpenings(pokes, own, open), own);
  if (holes.length === 0) return 0;
  const plugged = await plugFromInside(holes, pokes, `my pokeholes open into a cave (${holes.length} openings)`);
  if (!cells && plugged === 0) sealIdleUntil = Date.now() + SEAL_RETRY_MS;
  return plugged;
}

/**
 * A floor's room sealed off from a cave it opened into (game test: the 1st
 * floor's room had a big cave beside it; only its sleeves were ever sealed,
 * so walks to the sleeves went out through the room into the cave, and it
 * got stuck there on its own bridge). How many openings it plugged.
 */
async function sealRoomCaves(hub: Vec3, arrive: DirectionType, level: number): Promise<number> {
  const rec = mineRecord();
  if (!rec || !bot.entity) return 0;
  const R = STEP[RIGHT[arrive]];
  const F = STEP[arrive];
  const room: Vec3[] = [];
  for (const [a, b] of ROOM_CELLS) for (let dy = 0; dy < ROOM_HEIGHT; dy++) room.push(hub.plus(R.scaled(a)).plus(F.scaled(b)).offset(0, dy, 0));
  const open = (p: Pos): boolean => {
    const b = bot.blockAt(new Vec3(p.x, p.y, p.z));
    return b !== null && b.boundingBox === "empty" && !/water|lava|torch/.test(b.name);
  };
  const own = new Set<string>([...floorsAsDug(rec), ...mineStairCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom).walk, ...room].map((c) => c.toString()));
  for (const k of minedOre) own.add(k);
  const holes = bigCaveOpenings(caveOpenings(room, own, open), own);
  if (holes.length === 0) return 0;
  return plugFromInside(holes, room, `my ${floorName(level)}'s room opens into a cave (${holes.length} openings)`);
}

// Health under this, or a hostile mob this near: no more sealing this time
const SEAL_HEALTH = 14;
const SEAL_MOB_RANGE = 12;

/**
 * Plugs cave openings standing in its own tunnel beside each one, never out
 * in the cave (game test: sealing a mineshaft cavern's openings it walked
 * out among the mobs and a zombie killed it); stops while hurt or with a
 * hostile mob near. Each plug is remembered (put back if broken). How many.
 */
async function plugFromInside(holes: Pos[], ownCells: Vec3[], why: string): Promise<number> {
  const { getPriorityTargets } = await import("../actions/combat");
  const columns = new Map<string, number>(); // (x,z) of its cells -> their floor y
  for (const c of ownCells) {
    const k = `${c.x},${c.z}`;
    columns.set(k, Math.min(columns.get(k) ?? c.y, c.y));
  }
  // Enough to plug them all with first (game test: "nothing to fill the hole" after 5)
  await stockStairsFillers(holes.length);
  // Nothing to plug with: no walking from opening to opening for nothing
  if (!CAVE_FILL.some((n) => bot.inventory.items().some((i) => i.name === n))) {
    console.log(`Mine: ${why}; nothing to plug them with, so they wait.`);
    return 0;
  }
  const placed: Pos[] = [];
  let skipped = 0;
  // Stands it couldn't get to: the other openings by them aren't tried again this pass
  const unreachable = new Set<string>();
  const sorted = [...holes].sort((a, b) => bot.entity.position.distanceTo(new Vec3(a.x, a.y, a.z)) - bot.entity.position.distanceTo(new Vec3(b.x, b.y, b.z)));
  for (const h of sorted) {
    if (isCommandCancelled()) break;
    if ((bot.health ?? 20) < SEAL_HEALTH || getPriorityTargets(SEAL_MOB_RANGE).length > 0) {
      console.log("Mine: mobs near or hurt; the rest of the cave openings wait.");
      break;
    }
    const hole = new Vec3(h.x, h.y, h.z);
    // A column of its own tunnel beside the opening, to stand in
    // (never the column right over or under it: over a hole in the floor it'd fall in)
    const stand = SIX.filter((d) => d.y === 0).map((d) => ({ x: h.x + d.x, z: h.z + d.z }))
      .map((p) => (columns.has(`${p.x},${p.z}`) ? new Vec3(p.x, columns.get(`${p.x},${p.z}`)!, p.z) : null))
      .find((p): p is Vec3 => p !== null) ?? null;
    if (!stand) {
      skipped++;
      continue;
    }
    if (unreachable.has(stand.toString())) {
      skipped++;
      continue;
    }
    if (!bot.entity.position.floored().equals(stand) && !(await pathing.withRules({ digCost: 100 }, () => goTo(new pf.goals.GoalBlock(stand.x, stand.y, stand.z)))).ok) {
      unreachable.add(stand.toString());
      skipped++;
      continue;
    }
    if (bot.entity.position.offset(0, 1.62, 0).distanceTo(hole.offset(0.5, 0.5, 0.5)) > 4.5) {
      skipped++;
      continue;
    }
    if (await ensureBlock(hole, () => false, CAVE_FILL)) placed.push({ x: hole.x, y: hole.y, z: hole.z });
  }
  console.log(`Mine: ${why}; plugged ${placed.length} of ${holes.length} from inside${skipped ? ` (${skipped} out of reach from my tunnels)` : ""}.`);
  const rec = mineRecord();
  if (rec && placed.length > 0) {
    await saveMine(rec.start, rec.direction, rec.stairs, rec.branches, rec.bottom, { level: rec.level, arms: rec.arms, deepest: rec.deepest, cavePlugs: [...rec.cavePlugs, ...placed] });
  }
  return placed.length;
}

const FALLS = /^(gravel|sand|red_sand|suspicious_gravel|suspicious_sand)$/;

/**
 * Gravel and sand fallen into a sleeve's own cells (from `base`, `dug`
 * blocks going `way`), dug out nearest first, each column from the top.
 * How many it dug.
 */
async function digOutFallen(base: Vec3, way: DirectionType, dug: number): Promise<number> {
  const fallen: Vec3[] = [];
  for (let k = 1; k <= dug; k++) for (let dy = SLEEVE_HEIGHT - 1; dy >= 0; dy--) {
    const c = base.plus(STEP[way].scaled(k)).offset(0, dy, 0);
    if (FALLS.test(bot.blockAt(c)?.name ?? "")) fallen.push(c);
  }
  if (fallen.length === 0) return 0;
  const here = bot.entity.position;
  // Nearest column first; in a column, the top first (what's under it stays put)
  fallen.sort((a, b) => Math.round(a.distanceTo(here)) - Math.round(b.distanceTo(here)) || b.y - a.y);
  const { breakBlockAtResult } = await import("../actions/blockBreaking");
  let dugOut = 0;
  for (const c of fallen.slice(0, 24)) {
    if (isCommandCancelled()) break;
    if (!FALLS.test(bot.blockAt(c)?.name ?? "")) continue;
    if ((await breakBlockAtResult(c.x, c.y, c.z)).ok) dugOut++;
  }
  if (dugOut > 0) console.log(`Mine: dug ${dugOut} block${dugOut === 1 ? "" : "s"} of gravel or sand out of my tunnel.`);
  return dugOut;
}

// --- Caves its tunnels run into (owner) ---------------------------------------
// A pokehole that meets a cave ends there, the opening plugged; a sleeve
// crosses a short gap as a closed tube (floor, walls, roof) and ends at a big
// cave, its face plugged. Ore it can see from the opening is mined first, from
// inside the tunnel. Each plug is remembered and put back if it's broken.
const CAVE_FILL = ["cobblestone", "cobbled_deepslate", "dirt"];
// Open columns ahead that make a cave "big": a sleeve ends there instead of crossing
export const BIG_CAVE = 7;

/**
 * What a cave means for a tunnel at one column. `open(c)`: open cave air at
 * c (not its own dug tunnels, not water, lava or a torch). Pure.
 * - before the column is dug: "go" (no cave, or a sleeve's short gap),
 *   or "plug" (the face) and stop;
 * - after: the open blocks round it to plug, and whether the tunnel stops.
 */
export function caveAt(
  kind: "poke" | "sleeve",
  col: Pos,
  ahead: Pos,
  across: [Pos, Pos],
  height: number,
  open: (c: Pos) => boolean
): { before: Pos[]; stopBefore: boolean; around: Pos[]; stopAfter: boolean } {
  const at = (c: Pos, dx: number, dy: number, dz: number): Pos => ({ x: c.x + dx, y: c.y + dy, z: c.z + dz });
  const column = (c: Pos): Pos[] => Array.from({ length: height }, (_, y) => at(c, 0, y, 0));
  const face = [...column(col), at(col, 0, -1, 0)].filter(open);
  let stopBefore = face.length > 0;
  if (stopBefore && kind === "sleeve") {
    // A short gap is crossed as a tube: how many columns of cave from here
    let gap = 0;
    for (let c = col; gap < BIG_CAVE && [...column(c), at(c, 0, -1, 0)].some(open); c = at(c, ahead.x, 0, ahead.z)) gap++;
    stopBefore = gap >= BIG_CAVE;
  }
  const around: Pos[] = [];
  for (const side of across) for (let y = 0; y < height; y++) around.push(at(col, side.x, y, side.z));
  around.push(at(col, 0, height, 0));
  const holes = around.filter(open);
  return { before: stopBefore ? face : [], stopBefore, around: holes, stopAfter: holes.length > 0 && kind === "poke" };
}

/** The checks a sleeve or pokehole runs at each column for caves. */
function caveHooks(kind: "poke" | "sleeve", way: DirectionType, height: number): ColumnHooks {
  const rec = mineRecord();
  const dugCells = new Set<string>();
  if (rec) {
    for (const c of floorsAsDug(rec)) dugCells.add(c.toString());
    for (const c of mineStairCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom).walk) dugCells.add(c.toString());
    for (const c of pokePlanCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom)) dugCells.add(c);
  }
  const open = (p: Pos): boolean => {
    const c = new Vec3(p.x, p.y, p.z);
    const b = bot.blockAt(c);
    return b !== null && b.boundingBox === "empty" && !/water|lava|torch/.test(b.name) && !dugCells.has(c.toString());
  };
  const ahead = STEP[way];
  const across: [Pos, Pos] = [STEP[RIGHT[way]], STEP[LEFT[way]]];
  const what = kind === "poke" ? "pokehole" : "sleeve";
  return {
    before: async (col) => {
      const cave = caveAt(kind, col, ahead, across, height, open);
      if (!cave.stopBefore) return "go";
      // A pokehole meeting a small air pocket digs on through it
      if (kind === "poke" && bigCaveOpenings(cave.before, dugCells).length === 0) return "go";
      await oreFromTheOpening();
      await plugCave(cave.before, `my ${what} meets ${kind === "sleeve" ? "a big cave" : "a cave"} at ${col}`);
      return "stop";
    },
    after: async (col) => {
      // The column just dug is its own (never a cave opening)
      const column = Array.from({ length: height }, (_, dy) => new Vec3(col.x, col.y + dy, col.z));
      for (const c of column) dugCells.add(c.toString());
      // A cave beside it plugged first, then the ore the column uncovered
      // mined at once, standing where it is (owner: "a real player would
      // mine this out immediately"; architect review: per column, cave
      // first, ore holes counted as its own so they're never "a cave")
      const cave = caveAt(kind, col, ahead, across, height, open);
      // Small air pockets beside it are left open; only a real cave is plugged
      const around = bigCaveOpenings(cave.around, dugCells);
      if (around.length > 0) {
        await oreFromTheOpening();
        await plugCave(around, kind === "poke" ? `my pokehole opens into a cave at ${col}` : `my sleeve crosses a cave at ${col}: walls and roof`);
      }
      await mineOreAround(column, dugCells);
      await minePocketsLeft();
      return around.length > 0 && cave.stopAfter ? "stop" : "go";
    },
  };
}

// Ore cells it has mined out of its own tunnels' walls, floor and roof: its
// own holes, never cave openings to seal (architect review)
const minedOre = new Set<string>();
// Ore blocks of one vein it follows from a tunnel, at most
export const VEIN_MAX = 8;

/**
 * The ore a tunnel's cells uncovered: ore face-adjacent to them, and the
 * vein behind it (ore touching ore), only what `inReach`, at most `max`,
 * nearest the tunnel first. Pure over `nameAt` and `inReach`.
 */
export function veinFrom(cells: Vec3[], nameAt: (p: Vec3) => string | null, inReach: (p: Vec3) => boolean, max = VEIN_MAX): Vec3[] {
  const queue = exposedOres(cells, nameAt).filter(inReach);
  const seen = new Set(queue.map((p) => p.toString()));
  const own = new Set(cells.map((p) => p.toString()));
  const out: Vec3[] = [];
  while (queue.length > 0 && out.length < max) {
    const p = queue.shift()!;
    out.push(p);
    for (const d of SIX) {
      const n = p.offset(d.x, d.y, d.z);
      const k = n.toString();
      if (seen.has(k) || own.has(k)) continue;
      seen.add(k);
      if (/_ore$/.test(nameAt(n) ?? "") && inReach(n)) queue.push(n);
    }
  }
  return out;
}

/** The best pickaxe it carries, or null. */
function bestPickaxe(): string | null {
  const c = catalog();
  return bot.inventory.items().filter((i) => c.toolKind(i.name) === "pickaxe").sort((a, b) => c.toolTier(b.name) - c.toolTier(a.name))[0]?.name ?? null;
}

// Ore it said it had to leave for a better pickaxe (said once a trip, not every column)
let leftSaid = new Set<string>();

/**
 * The ore the tunnel cells `cells` just uncovered mined at once, standing
 * where it is (no walking, no walls opened to the pathfinder): only ore its
 * pickaxe harvests (the rest is left for a better one and said so), never
 * with a full bag; a hole in its floor filled straight away. Each mined
 * cell is added to `own`. How many it mined.
 */
async function mineOreAround(cells: Vec3[], own: Set<string>): Promise<number> {
  const nameAt = (p: Vec3): string | null => bot.blockAt(p)?.name ?? null;
  const ores = veinFrom(cells, nameAt, (p) => withinReach(p));
  if (ores.length === 0) return 0;
  const { breakBlock } = await import("../core/primitives");
  const { ensureBlock } = await import("../actions/digging");
  const pickaxe = bestPickaxe();
  const floorY = Math.min(...cells.map((c) => c.y));
  const left = new Set<string>();
  let got = 0;
  for (const o of ores) {
    if (isCommandCancelled() || hurtInTheMine()) break;
    const name = nameAt(o) ?? "";
    if (!/_ore$/.test(name) || oreCapped(name)) continue;
    if (!pickaxe || !catalog().canHarvest(name, pickaxe)) {
      left.add(name.replace(/^deepslate_/, "").replace(/_ore$/, ""));
      continue;
    }
    if (bot.inventory.emptySlotCount() === 0) break; // the trip's own pass and the haul home deal with it
    if (!(await breakBlock(o)).ok) continue;
    got++;
    own.add(o.toString());
    minedOre.add(o.toString());
    // Ore in its floor: the hole filled at once (the next step would drop into it)
    if (o.y === floorY - 1 && cells.some((c) => c.x === o.x && c.z === o.z)) await ensureBlock(o, () => false, CAVE_FILL);
  }
  if (got > 0) {
    const { pickupNearbyItems } = await import("../actions/pickup");
    await pickupNearbyItems(bot, 4);
    console.log(`Mine: mined ${got} ore my tunnel uncovered.`);
  }
  const fresh = [...left].filter((k) => !leftSaid.has(k));
  if (fresh.length > 0) {
    for (const k of fresh) leftSaid.add(k);
    chatter(`Found ${fresh.join(" and ")} ore in my tunnel; it needs a better pickaxe than mine, so it waits for one.`, "mining");
  }
  return got;
}

/**
 * Ore it can see from where it stands, within reach, mined without stepping
 * out of its tunnel (owner: before plugging a cave, the ore in it it can see).
 */
async function oreFromTheOpening(): Promise<number> {
  const ids = Object.values(bot.registry.blocksByName).filter((b) => /_ore$/.test(b.name)).map((b) => b.id);
  const eyes = bot.entity.position.offset(0, 1.62, 0);
  const near = bot
    .findBlocks({ matching: ids, maxDistance: 5, count: 16 })
    .map((p) => bot.blockAt(p))
    .filter((b): b is NonNullable<typeof b> => b !== null && b.position.offset(0.5, 0.5, 0.5).distanceTo(eyes) <= 4.5 && bot.canSeeBlock(b));
  if (near.length === 0) return 0;
  const { breakBlock } = await import("../core/primitives");
  const { pickupNearbyItems } = await import("../actions/pickup");
  let got = 0;
  for (const b of near) {
    if (isCommandCancelled()) break;
    if ((await breakBlock(b.position)).ok) got++;
  }
  if (got > 0) {
    await pickupNearbyItems(bot, 3);
    console.log(`Mine: mined ${got} ore I could see in the cave from my tunnel.`);
  }
  return got;
}

/** Fills a cave's openings with cobblestone and remembers each plug (put back if it's broken). */
async function plugCave(cells: Pos[], why: string): Promise<number> {
  let plugged = 0;
  const placed: Pos[] = [];
  for (const p of cells) {
    if (isCommandCancelled()) break;
    const c = new Vec3(p.x, p.y, p.z);
    if (await ensureBlock(c, () => false, CAVE_FILL)) {
      plugged++;
      placed.push({ x: c.x, y: c.y, z: c.z });
    }
  }
  console.log(`Mine: ${why}; plugged ${plugged} of ${cells.length} openings.`);
  const rec = mineRecord();
  if (rec && placed.length > 0) {
    await saveMine(rec.start, rec.direction, rec.stairs, rec.branches, rec.bottom, { level: rec.level, arms: rec.arms, deepest: rec.deepest, cavePlugs: [...rec.cavePlugs, ...placed] });
  }
  return plugged;
}

/** Its cave plugs but those in its stairs' walking cells (`stairs`: Vec3 strings). Pure. */
export function plugsOutsideStairs(plugs: Pos[], stairs: Set<string>): Pos[] {
  return plugs.filter((p) => !stairs.has(`(${p.x}, ${p.y}, ${p.z})`));
}

/** Its cave plugs near it put back where they've been broken (a creeper, a player). */
async function recheckCavePlugs(): Promise<number> {
  const rec = mineRecord();
  if (!rec || rec.cavePlugs.length === 0 || !bot.entity) return 0;
  // A plug in its own tunnels' cells (a sleeve's wall where a pokehole
  // starts, dug through by it) stays open (game test: 12 put back, the
  // pokeholes' entrances sealed); so does one in its stairs, dug deeper
  // through it (game test: a sleeve plugged the next flight's cells beside
  // it, and this pass would have sealed the stairs again), and it's no
  // longer a plug at all
  const tunnels = new Set(floorsAsDug(rec).map((c) => c.toString()));
  for (const c of pokePlanCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom)) tunnels.add(c);
  const stairs = new Set(mineStairCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom).walk.map((c) => c.toString()));
  const plugs = plugsOutsideStairs(rec.cavePlugs, stairs);
  if (plugs.length < rec.cavePlugs.length) {
    console.log(`Mine: ${rec.cavePlugs.length - plugs.length} cave plug(s) now in my stairs; not plugs any more.`);
    await saveMine(rec.start, rec.direction, rec.stairs, rec.branches, rec.bottom, { level: rec.level, arms: rec.arms, deepest: rec.deepest, cavePlugs: plugs });
  }
  const broken = plugs
    .map((p) => new Vec3(p.x, p.y, p.z))
    .filter((c) => !tunnels.has(c.toString()))
    .filter((c) => {
      const b = bot.blockAt(c);
      return c.distanceTo(bot.entity.position) <= LOOK_AFTER_RANGE && b !== null && b.boundingBox === "empty" && !/water|lava/.test(b.name);
    });
  let put = 0;
  for (const c of broken) {
    if (isCommandCancelled()) break;
    if (bot.entity.position.distanceTo(c) > 4 && !(await goTo(new pf.goals.GoalNear(c.x, c.y, c.z, 3))).ok) continue;
    if (await ensureBlock(c, () => false, CAVE_FILL)) put++;
  }
  if (put > 0) console.log(`Mine: put back ${put} broken cave plug${put === 1 ? "" : "s"}.`);
  return put;
}

/** How many blocks of a sleeve from `base` going `way` are open and dry at its feet (as far as it was dug). */
function openRun(base: Vec3, way: DirectionType): number {
  let k = 0;
  while (k < ARM_LENGTH) {
    const b = bot.blockAt(base.plus(STEP[way].scaled(k + 1)));
    if (!b || b.boundingBox !== "empty" || /water|lava/.test(b.name)) break;
    k++;
  }
  return k;
}

/** Open, dry (no water or lava) and within reach of a walk. */
const openDryNear = (c: Vec3): boolean => {
  const b = bot.blockAt(c);
  return c.distanceTo(bot.entity.position) <= LOOK_AFTER_RANGE && b !== null && b.boundingBox === "empty" && !/water|lava/.test(b.name);
};

/** The dug-out cells of its floors (rooms, sleeves, pokeholes) within reach of a walk. */
function dugFloorCells(): Vec3[] {
  const rec = mineRecord();
  if (!rec || !bot.entity) return [];
  return floorsAsDug(rec).filter(openDryNear);
}

// Water or lava beside an ore: it's left (breaking it would let it in)
const LIQUID_NAME = /\b(water|lava)\b/;

/** Ore blocks touching an open cell (`open`), none with water or lava beside it. Pure over `nameAt`. */
export function exposedOres(open: Vec3[], nameAt: (p: Vec3) => string | null): Vec3[] {
  const seen = new Set<string>();
  const out: Vec3[] = [];
  for (const c of open) {
    for (const d of DIRS6) {
      const n = c.plus(d);
      const k = n.toString();
      if (seen.has(k)) continue;
      seen.add(k);
      if (/_ore$/.test(nameAt(n) ?? "") && !LIQUID_NAME.test(DIRS6.map((e) => nameAt(n.plus(e)) ?? "").join(" "))) out.push(n);
    }
  }
  return out;
}

/**
 * Every ore its floors' tunnels uncovered, mined (owner: ore left in the
 * walls and ceilings; only what was in sight within 6 blocks of where it
 * stood got mined): each ore block touching a dug cell, walked to and
 * broken, the ore behind it too as it comes into the open. How many.
 */
export async function mineExposedOres(): Promise<number> {
  return whileGathering(() => mineExposedOresNow());
}

async function mineExposedOresNow(): Promise<number> {
  const { breakBlockAtResult } = await import("../actions/blockBreaking");
  const { pickupNearbyItems } = await import("../actions/pickup");
  let mined = 0;
  for (let pass = 0; pass < 3 && !isCommandCancelled(); pass++) {
    const open = dugFloorCells();
    const openSet = new Set(open.map((c) => c.toString()));
    const ores = exposedOres(open, (p) => bot.blockAt(p)?.name ?? null).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    if (ores.length === 0) break;
    let got = 0;
    for (const ore of ores) {
      if (isCommandCancelled() || hurtInTheMine()) break;
      if (!/_ore$/.test(bot.blockAt(ore)?.name ?? "")) continue;
      // Plenty of it already: left in the wall (owner: no more copper past 32)
      if (oreCapped(bot.blockAt(ore)?.name ?? "")) continue;
      // One its pickaxe can't mine: left for a better one (no walking to it for nothing)
      const pick = bestPickaxe();
      if (!pick || !catalog().canHarvest(bot.blockAt(ore)?.name ?? "", pick)) continue;
      // From the dug cell beside it
      const from = DIRS6.map((d) => ore.plus(d)).find((c) => openSet.has(c.toString()));
      if (from && bot.entity.position.distanceTo(from) > 4 && !(await goTo(new pf.goals.GoalNear(from.x, from.y, from.z, 1))).ok) continue;
      const broken = await breakBlockAtResult(ore.x, ore.y, ore.z);
      if (broken.ok) {
        got++;
        await pickupNearbyItems(bot, 4);
      }
    }
    mined += got;
    if (got === 0) break;
  }
  if (mined > 0) console.log(`Mine: mined ${mined} ore blocks the tunnels had uncovered.`);
  return mined;
}

/** Blocks it left standing in its floors' tunnels (footholds a walk put down), taken out, the whole floor. */
async function clearLeftovers(): Promise<number> {
  const rec = mineRecord();
  if (!rec || !bot.entity) return 0;
  const { isOwnScaffold } = await import("../core/scaffold");
  const { breakBlock } = await import("../core/primitives");
  const cells: Vec3[] = [];
  for (let l = 0; l <= rec.level && hubStep(l) < rec.stairs; l++) {
    const h = hubStep(l);
    cells.push(...floorCells(stepAt(rec.start, rec.direction, h, rec.turns), dirAt(rec.direction, h, rec.turns), l, roomBeside(l, rec.sideFrom)));
  }
  const left = cells.filter((c) => c.distanceTo(bot.entity.position) <= LOOK_AFTER_RANGE && isOwnScaffold(c)).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
  let cleared = 0;
  for (const c of left) {
    if (isCommandCancelled()) break;
    if (bot.entity.position.distanceTo(c) > 4 && !(await goTo(new pf.goals.GoalNear(c.x, c.y, c.z, 2))).ok) continue;
    if ((await breakBlock(c)).ok) cleared++;
  }
  if (cleared > 0) console.log(`Mine: took ${cleared} block${cleared === 1 ? "" : "s"} I'd left standing out of my tunnels.`);
  return cleared;
}

/**
 * Its floors looked after on a trip (owner): every way in from outside
 * blocked, the blocks it left in the tunnels taken out, every ore the
 * tunnels uncovered mined.
 */
export async function lookAfterFloors(): Promise<void> {
  await recheckCavePlugs();
  if (isCommandCancelled()) return;
  await sealPokeCaves();
  if (isCommandCancelled()) return;
  await sealMineFromOutside();
  if (isCommandCancelled()) return;
  await clearLeftovers();
  if (isCommandCancelled()) return;
  await mineExposedOres();
}

/** Open sky straight over a cell (up to 40 blocks; leaves count as sky, a tree's). */
function seesSkyCheap(p: Vec3): boolean {
  for (let dy = 1; dy <= 40; dy++) {
    const b = bot.blockAt(p.offset(0, dy, 0));
    if (!b) return true;
    if (b.boundingBox === "block" && !b.name.endsWith("_leaves")) return false;
  }
  return true;
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
export async function lookAfterStairs(): Promise<number> {
  const rec = mineRecord();
  if (!rec) return 0;
  const { lightSpot } = await import("../actions/digging");
  const { walk } = mineStairCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom);
  const tunnels = hubTunnelCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom);
  const walkSet = new Set(walk.map((c) => c.toString()));
  // Enough to build with for every hole first (it came down with 7
  // cobblestone and left a cavern's worth of steps open)
  await stockStairsFillers(allShellHoles(rec, walkSet, tunnels).length);
  const inWalk = (p: Vec3): boolean => walkSet.has(p.toString());
  const torchIds = ["torch", "wall_torch"].map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  const darkAt = (s: Vec3): boolean => bot.findBlocks({ matching: torchIds, point: s, maxDistance: 5, count: 1 }).length === 0;
  let filled = 0;
  let lit = 0;
  let raised = 0;
  let cleared = 0;
  let noTorch = "";
  let mined = 0;
  for (let i = 1; i < rec.stairs; i++) {
    if (isCommandCancelled()) return allShellHoles(rec, walkSet, tunnels).length;
    const s = stepAt(rec.start, rec.direction, i, rec.turns);
    // Ore in the step's walls, floor or roof mined first, with the vein
    // behind it: the holes it leaves are walled up just below with the rest
    mined += await mineStepOre(rec, i, s);
    // The whole step: its floor, both walls the full height and its roof
    // (owner: the stairs between the floors must be whole, walls and all, so
    // no skeleton shoots in from a cave; it went on mining with steps blown
    // out over a cavern)
    const holes = shellHoles(rec, i, walkSet, tunnels);
    const torch = !noTorch && i % STAIR_TORCH_EVERY === 0 && darkAt(s);
    // Stairs dug before they were made a block higher: the top cell dug out now
    const low = bot.blockAt(s.offset(0, stepHeadroom(i, s.y), 0));
    const raise = low !== null && low.boundingBox === "block" && !low.name.includes("torch") && !low.name.endsWith("_sign");
    // Gravel or sand fallen into the step (or anything else filling it):
    // walks won't dig a block with gravel over it, so it stood on the step
    // above for five minutes (game test; the owner dug it out by hand)
    const fallen = Array.from({ length: stepHeadroom(i, s.y) }, (_, dy) => s.offset(0, dy, 0)).filter((c) => fillsStep(bot.blockAt(c)) && !holdsBackLiquid(c));
    if (holes.length === 0 && !torch && !raise && fallen.length === 0) continue;
    // A hole in this step's own floor, or the step filled: worked on from the step above
    const floorHole = holes.some((h) => h.equals(s.offset(0, -1, 0)));
    const stand = floorHole || fallen.length > 0 ? stepAt(rec.start, rec.direction, i - 1, rec.turns) : s;
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
    const keepClear = (p: Vec3): boolean => inWalk(p) || tunnels.has(p.toString());
    // Its floor from the step above, then the rest standing on it
    const floor = s.offset(0, -1, 0);
    filled += await fillFromSolid(holes.filter((h) => h.equals(floor)), keepClear);
    if (floorHole && holes.length > 1 && !(await goToStep(s)).ok) continue;
    filled += await fillFromSolid(holes.filter((h) => !h.equals(floor)), keepClear);
    if (raise) {
      const { breakBlock } = await import("../core/primitives");
      if ((await breakBlock(s.offset(0, stepHeadroom(i, s.y), 0))).ok) raised++;
    }
    if (torch) {
      const placed = await lightSpot(s.offset(0, 1, 0), dirAt(rec.direction, i, rec.turns));
      if (placed === true) lit++;
      else noTorch = placed; // no torches or coal: not again this trip
    }
  }
  if (mined > 0) console.log(`Mine: mined ${mined} ore from my stairs' walls.`);
  if (filled + lit + raised + cleared > 0) console.log(`Mine: looked after my stairs: ${filled} holes filled, ${lit} torches put up, ${raised} steps made a block higher, ${cleared} fallen blocks dug out.`);
  if (noTorch) console.log(`Mine: my stairs stay dark in places (${noTorch}).`);
  const left = allShellHoles(rec, walkSet, tunnels);
  if (left.length > 0) console.log(`Mine: my stairs still have ${left.length} open blocks of floor, wall or roof (first at ${left[0]}).`);
  return left.length;
}

/**
 * The ore in a step's floor, walls and roof (and the vein behind, as far as
 * it reaches), mined standing on the step, or on the one above for ore in
 * its floor. Copper past its cap and ore its pickaxe can't break stay.
 * Nothing mines the stairs' shell otherwise: the floors' ore pass looks only
 * along the floors' tunnels. How many blocks.
 */
async function mineStepOre(rec: MineRecord, i: number, s: Vec3): Promise<number> {
  const cells = Array.from({ length: stepHeadroom(i, s.y) + 1 }, (_, dy) => s.offset(0, dy, 0));
  const nameAt = (p: Vec3): string | null => bot.blockAt(p)?.name ?? null;
  const pick = bestPickaxe();
  const wanted = (p: Vec3): boolean => {
    const name = nameAt(p) ?? "";
    return /_ore$/.test(name) && pick !== null && catalog().canHarvest(name, pick) && !oreCapped(name);
  };
  const seen = exposedOres(cells, nameAt).filter(wanted);
  if (seen.length === 0 || isCommandCancelled() || hurtInTheMine()) return 0;
  const floor = s.offset(0, -1, 0);
  const stand = i > 1 && seen.some((o) => o.equals(floor)) ? stepAt(rec.start, rec.direction, i - 1, rec.turns) : s;
  if (!(await goToStep(stand)).ok) return 0;
  const { breakBlock } = await import("../core/primitives");
  let got = 0;
  for (const o of veinFrom(cells, nameAt, (p) => withinReach(p), VEIN_MAX).filter(wanted)) {
    if (isCommandCancelled() || hurtInTheMine() || bot.inventory.emptySlotCount() === 0) break;
    if ((await breakBlock(o)).ok) {
      got++;
      minedOre.add(o.toString());
    }
  }
  if (got > 0) {
    const { pickupNearbyItems } = await import("../actions/pickup");
    await pickupNearbyItems(bot, 4);
    if (!stand.equals(s)) await goToStep(s);
  }
  return got;
}

/** A step just dug: its open floor, walls and roof filled (fillers stocked first). */
async function mendNewStep(i: number): Promise<void> {
  const rec0 = mineRecord();
  if (!rec0 || isCommandCancelled()) return;
  const rec = { ...rec0, stairs: Math.max(rec0.stairs, i + 1) };
  const { walk } = mineStairCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom);
  const tunnels = hubTunnelCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom);
  const walkSet = new Set(walk.map((c) => c.toString()));
  const holes = shellHoles(rec, i, walkSet, tunnels);
  if (holes.length === 0) return;
  await stockStairsFillers(holes.length);
  const filled = await fillFromSolid(holes, (p) => walkSet.has(p.toString()) || tunnels.has(p.toString()));
  console.log(`Mine: step ${i} closed in (${filled} of ${holes.length} open blocks of floor, wall or roof filled).`);
}

const STAIRS_FILL = ["cobblestone", "cobbled_deepslate", "dirt", "coarse_dirt", "netherrack"];
const SIDES6 = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

/**
 * Fills open blocks of its stairs' shell growing out from what's solid: each
 * pass places the holes that have a solid block beside them (from the
 * stairs, where it stands), until none is left or nothing more goes in;
 * only then support blocks for what still floats (game test: it went down
 * into the cavern under its stairs to prop a floor block, and a spider
 * there killed it). How many it filled.
 */
async function fillFromSolid(holes: Vec3[], keepClear: (p: Vec3) => boolean): Promise<number> {
  const { placeBlockResult } = await import("../actions/blockPlacing");
  const filler = (): string | null => STAIRS_FILL.find((n) => bot.inventory.items().some((i) => i.name === n)) ?? null;
  const solidBeside = (h: Vec3): boolean => SIDES6.some((d) => bot.blockAt(h.plus(d))?.boundingBox === "block");
  let left = holes;
  let filled = 0;
  for (let pass = 0; pass < 8 && left.length > 0; pass++) {
    const next: Vec3[] = [];
    for (const h of left) {
      if (isCommandCancelled()) return filled;
      if (!isOpenForStairs(bot.blockAt(h))) continue; // filled meanwhile (a support)
      const name = filler();
      if (!name) return filled;
      if (!solidBeside(h)) {
        next.push(h);
        continue;
      }
      if ((await placeBlockResult(name, h.x, h.y, h.z, "side")).ok) filled++;
      else next.push(h);
    }
    if (next.length === left.length) break; // nothing more went in
    left = next;
  }
  // Still floating: support blocks (the old way), best effort
  if (left.length > 0) {
    const { ensureBlock } = await import("../actions/digging");
    for (const h of left) {
      if (isCommandCancelled()) return filled;
      if (isOpenForStairs(bot.blockAt(h)) && (await ensureBlock(h, keepClear))) filled++;
    }
  }
  return filled;
}

type StairsRec = { start: Pos; direction: DirectionType; stairs: number; level: number; turns: Turn[] };

/**
 * A step's floor, side walls and roof that are open (air, a cave, water),
 * floor first, the walls bottom up, the roof last (each next to one already
 * there). Never its own walking space or a floor's tunnels; what isn't
 * loaded doesn't count.
 */
export function shellHoles(rec: StairsRec, i: number, walk: Set<string>, tunnels: Set<string>, at: (p: Vec3) => { name: string; boundingBox: string } | null = (p) => bot.blockAt(p)): Vec3[] {
  return stepShell(rec.start, rec.direction, i, rec.level, rec.turns)
    .filter((c) => !walk.has(c.toString()) && !tunnels.has(c.toString()) && isOpenForStairs(at(c)))
    .sort((a, b) => a.y - b.y);
}

const isOpenForStairs = (b: { name: string; boundingBox: string } | null): boolean =>
  b !== null && (b.boundingBox === "empty" || b.name === "water" || b.name === "lava") && !/torch|sign|ladder|door/.test(b.name);

/** Every open block of its stairs' shell, top step down. */
function allShellHoles(rec: StairsRec, walk: Set<string>, tunnels: Set<string>): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 1; i < rec.stairs; i++) out.push(...shellHoles(rec, i, walk, tunnels));
  return out;
}

// Blocks it carries beyond the holes it's about to fill (supports over a cave)
const STAIRS_FILLER_SPARE = 16;

/**
 * Enough to build with for `holes` blocks of its stairs: from its chests
 * when it's at home (room made first), else stone from the walls round it
 * (never its stairs' or shelter's: collecting skips what's protected).
 */
async function stockStairsFillers(holes: number): Promise<void> {
  if (holes === 0) return;
  const FILL = ["cobblestone", "cobbled_deepslate", "dirt", "coarse_dirt", "netherrack"];
  const have = (): number => bot.inventory.items().filter((i) => FILL.includes(i.name)).reduce((n, i) => n + i.count, 0);
  const want = holes + STAIRS_FILLER_SPARE;
  if (have() >= holes) return;
  const rec = mineRecord();
  const upTop = rec !== null && bot.entity.position.y > rec.start.y - 3;
  if (upTop) {
    const { storedNear, takeItems } = await import("../actions/storage");
    if (storedNear("cobblestone") > 0) {
      const { makeRoom } = await import("../actions/overflow");
      await makeRoom("take cobblestone for my stairs", ["cobblestone"]);
      await takeItems([{ name: "cobblestone", count: want - have() }], true);
    }
  }
  if (have() < holes) {
    // Stone, and deepslate down where there's no stone (it drops cobbled deepslate)
    let got = 0;
    for (const rock of ["stone", "deepslate"]) {
      if (have() >= holes || isCommandCancelled()) break;
      got += await collectBlock(rock, want - have(), ORE_REACH, { seenOnly: true });
    }
    console.log(`Mine: ${holes} open blocks in my stairs; took ${got} stone or deepslate to build them with.`);
  }
}

async function saveMine(start: Pos, direction: DirectionType, stairs: number, branches: number, bottom: Vec3 | null, levels?: { level: number; arms: Arms; deepest: boolean; turns?: Turn[]; tried?: Record<string, DirectionType[]>; seals?: Pos[]; cavePlugs?: Pos[]; exhausted?: boolean; sidesDone?: number; roomsDone?: number }): Promise<void> {
  const endsAt = bottom ?? mineBottom(start, direction);
  const rec0 = mineRecord();
  const keep = {
    ...(levels ?? (rec0 ? { level: rec0.level, arms: rec0.arms, deepest: rec0.deepest } : { level: 0, arms: freshArms(), deepest: false })),
    // Its turns and what it tried at each hub, kept unless given
    turns: levels?.turns ?? rec0?.turns ?? [],
    tried: levels?.tried ?? rec0?.tried ?? {},
    seals: levels?.seals ?? rec0?.seals ?? [],
    cavePlugs: levels?.cavePlugs ?? rec0?.cavePlugs ?? [],
    exhausted: levels?.exhausted ?? rec0?.exhausted ?? false,
    sidesDone: levels?.sidesDone ?? rec0?.sidesDone ?? 0,
    roomsDone: levels?.roomsDone ?? rec0?.roomsDone ?? -1,
    sideFrom: rec0?.sideFrom ?? 0,
  };
  await addPlace({
    kind: "mine",
    name: MINE_NAME,
    dimension: currentDimension(),
    ...start,
    details: { direction, depth: firstFloorAt, stairs, done: bottom !== null, endsAt: { x: endsAt.x, y: endsAt.y, z: endsAt.z }, branches, ...keep },
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
// Pickaxes it takes down the mine (owner: 3 in the bag, just in case)
export const SPARE_PICKAXES = 3;
/** Stone-or-better pickaxes it carries. */
const pickaxesForTrip = (): number =>
  bot.inventory.items().filter((i) => i.name.endsWith("_pickaxe") && i.name !== "wooden_pickaxe" && i.name !== "golden_pickaxe").reduce((n, i) => n + i.count, 0);

/**
 * Where its stairs turned (owner: blocked going down, back to the crossroad
 * above and on to the right, then the left): from hub step `at`, the steps
 * after it go `dir`. Ordered by `at`.
 */
export type Turn = { at: number; dir: DirectionType };

/** The way the stairs go into step `i` (step 0: the way they start). Pure. */
export function dirAt(dir: DirectionType, i: number, turns: Turn[] = []): DirectionType {
  let d = dir;
  for (const t of turns) if (t.at < i) d = t.dir;
  return d;
}

/** Step `i` of stairs from `start` going `dir`, turning where `turns` say. Pure. */
export function stepAt(start: Pos, dir: DirectionType, i: number, turns: Turn[] = []): Vec3 {
  let p = new Vec3(start.x, start.y, start.z);
  for (let k = 1; k <= i; k++) p = p.plus(STEP[dirAt(dir, k, turns)]).offset(0, isFlatStep(k) ? 0 : -1, 0);
  return p;
}

/**
 * Where to stand to be at a step or a hub: the cell itself, or on top of it
 * once it's paved (a stair block fills the cell: walks aimed inside it got
 * "0 moves" after the hubs were paved, game test).
 */
function standAt(cell: Vec3): Vec3 {
  return bot.blockAt(cell)?.name.endsWith("_stairs") ? cell.offset(0, 1, 0) : cell;
}

/** Walks to stand at a step, a hub or a tunnel's end (paved or not); from up top, down its stairs first. */
const goToStep = async (cell: Vec3): Promise<ActionResult> => {
  // Never to a part of its mine that isn't dug yet: the walk would dig its
  // own way down from the grass (game test: its stairs ended at step 6, the
  // coal trip walked to where the 1st floor's room would be, 15 below, and
  // dug a winding tunnel down to it from outside)
  const rec = mineRecord();
  if (rec && rec.stairs > 0 && cell.y < stepAt(rec.start, rec.direction, rec.stairs - 1, rec.turns).y - 2) {
    return fail("refused", `that part of my mine isn't dug yet (its stairs end at step ${rec.stairs - 1})`);
  }
  await downIntoTheMine(cell);
  const at = standAt(cell);
  return goTo(new pf.goals.GoalBlock(at.x, at.y, at.z));
};

/**
 * From up top to somewhere down in its mine: in by its shelter and down its
 * own stairs to that floor's room (or the step nearest), never a new way dug
 * down through the ground (game test: the coal trip, starting from the trees
 * it had cut, dug a shaft straight down from the grass to its mine). Best
 * effort; nothing when it's down there already or isn't going down.
 */
export async function downIntoTheMine(target: Pos): Promise<void> {
  const rec = mineRecord();
  if (!rec || rec.stairs < 2 || !bot.entity) return;
  const top = rec.start.y - 3;
  if (bot.entity.position.y <= top || target.y > top) return;
  const floor = floorAtHeight(rec, target.y);
  const i = floor !== null ? hubStep(floor) : nearestStairStep(target, rec.start, rec.direction, rec.stairs, rec.turns);
  if (i === null) return;
  console.log(`Down to my mine by its stairs: to step ${i}.`);
  const { walkIntoShelter } = await import("../actions/building");
  const home = await walkIntoShelter();
  if (!home.ok || isCommandCancelled()) return;
  const step = standAt(stepAt(rec.start, rec.direction, i, rec.turns));
  // Down its stairs: digging made too dear to choose (only with no other way)
  await pathing.withRules({ digCost: 100 }, () => goTo(new pf.goals.GoalNear(step.x, step.y, step.z, 1)));
}

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
  // Turned aside from water, lava or a drop above the first floor (earlyTurn)
  let turns = rec?.turns ?? [];
  let tried = rec?.tried ?? {};
  // From inside the shelter, never from the grass above it (that dug a hole
  // to the sky through the roof over the exit)
  const inside = await goTo(new pf.goals.GoalBlock(slots.stand.x, slots.stand.y, slots.stand.z));
  if (!inside.ok) return inside;
  if (from === 0) report(`Digging my mine: ${firstFloorAt} steps down from the back of my shelter to its first floor.`);
  for (let i = from; i < stairsToFirstFloor(); i++) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    // The wooden pickaxe only for the cobblestone the stone tools need
    if (!hasStonePickaxe() && carried(["cobblestone"]) >= woodUntilCobblestone) {
      console.log(`Mine: ${i} of ${stairsToFirstFloor()} stairs, enough cobblestone for stone tools; the rest with a stone pickaxe.`);
      return ok();
    }
    const step = stepAt(start, dir, i, turns);
    if (!(await digDiagonalTunnel(dirAt(dir, i, turns), 0, { width: 1, height: stepHeadroom(i, step.y) }, step, MINE_NAME, undefined, { save: false }))) {
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
      // A dig that may work next time: carry on from this step then
      if (why === "dig_failed" || why === "unloaded") {
        await saveMine(start, dir, i, 0, null);
        return fail("unreachable", "a block of my mine's stairs wouldn't dig (I'll try again)");
      }
      // Over a cave with nothing to build the floor with: get dirt or
      // cobblestone (the planner) and carry on from this step next time
      if (why === "no_filler") {
        await saveMine(start, dir, i, 0, null);
        return fail("missing_items", "nothing to build my mine stairs' floor with over a cave (dirt or cobblestone)");
      }
      // Water, lava or a drop before the first floor: that step closed off,
      // the stairs go on to one side from the step before (owner, 2026-11-28:
      // the stairs hit water at step 6 and the mine counted as done there)
      const side = earlyTurn(dir, turns, tried, i);
      if (side) {
        const was = dirAt(dir, i, turns.filter((t) => t.at < i - 1));
        const closed = await closeOffStep(step, i);
        turns = [...turns.filter((t) => t.at < i - 1), { at: i - 1, dir: side }];
        tried = { ...tried, [String(i - 1)]: [...new Set([...(tried[String(i - 1)] ?? []), was, side])] };
        await saveMine(start, dir, i, 0, null, { level: 0, arms: freshArms(), deepest: false, turns, tried });
        report(`My mine's stairs hit ${why === "drop" ? "a drop" : "water or lava"} at step ${i}; I closed that step off${closed ? "" : " as best I could"} and they go on to the ${side === RIGHT[was] ? "right" : "left"} from step ${i - 1}.`);
        i--; // the same step again, the new way
        continue;
      }
      if (i - 1 >= SHALLOWEST_MINE) {
        // Water, lava or a drop it can't floor below, both ways tried: a mine this deep is still a mine
        console.log(`Mine: stairs stopped at step ${i} (${why ?? "stopped"}); the mine ends ${i - 1} levels down.`);
        await saveMine(start, dir, i, 0, stepAt(start, dir, i - 1, turns));
        return ok();
      }
      await saveMine(start, dir, i, 0, null);
      return fail("refused", why === "drop" ? "my mine's stairs reach a drop near the top that I can't build a floor over" : "the mine's stairs hit lava, water or something built near the top");
    }
    await saveMine(start, dir, i + 1, 0, i + 1 >= stairsToFirstFloor() ? stepAt(start, dir, firstFloorAt, turns) : null);
  }
  return myMine() ? ok() : fail("error", "the mine wasn't remembered");
}

/**
 * The way its stairs turn when step `i`, above the first floor, is blocked
 * (water, lava, a drop): to the right or the left of where they were going,
 * from step i-1, whichever wasn't tried there yet; null when both were (or
 * at the doorway's first step, which can't turn). Pure.
 */
export function earlyTurn(dir: DirectionType, turns: Turn[], tried: Record<string, DirectionType[]>, i: number): DirectionType | null {
  const at = i - 1;
  if (at < 1) return null;
  // The way they went before any turn there (a first turn there is replaced)
  const was = dirAt(dir, i, turns.filter((t) => t.at < at));
  const done = tried[String(at)] ?? [];
  return [RIGHT[was], LEFT[was]].find((d) => !done.includes(d)) ?? null;
}

/**
 * A blocked step's open cells filled (standing on the step before), so the
 * turned stairs leave no hole toward the water or the drop. True when all of
 * them are solid now.
 */
async function closeOffStep(step: Vec3, i: number): Promise<boolean> {
  const { ensureBlock } = await import("../actions/digging");
  let all = true;
  for (let dy = stepHeadroom(i, step.y); dy >= 0; dy--) {
    if (isCommandCancelled()) return false;
    const cell = step.offset(0, dy, 0);
    const b = bot.blockAt(cell);
    if (!b || b.boundingBox !== "empty" || /water|lava/.test(b.name)) continue;
    if (!(await ensureBlock(cell))) all = false;
  }
  return all;
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
  // (the flat part across each floor's room is floor, not stairs)
  const steps: number[] = [];
  for (let i = 1; i < stairs; i++) if (!isFlatStep(i)) steps.push(i);
  return steps;
}

/** The hub steps of a mine `level` levels deep (where the side tunnels leave the stairs). Pure. */
export function hubSteps(level: number): Set<number> {
  return new Set(Array.from({ length: level + 1 }, (_, l) => hubStep(l)));
}

/** The steps of its mine's stairs still without a stair block (as far as it can see). */
/** True when the cell holds water (or a waterlogged block). */
const wet = (p: Vec3): boolean => {
  const b = bot.blockAt(p);
  return b !== null && (b.name === "water" || b.name === "bubble_column" || (b.getProperties() as { waterlogged?: boolean }).waterlogged === true);
};

export function unpavedSteps(): number[] {
  const rec = mineRecord();
  if (!rec?.bottom) return [];
  return stepsToPave(rec.stairs).filter((i) => {
    const step = stepAt(rec.start, rec.direction, i, rec.turns);
    const b = bot.blockAt(step);
    if (b === null || b.name.endsWith("_stairs")) return false;
    // Under water (its flooded bottom): left bare, never dived for (game
    // test: it went down into the water to pave the last two steps and got stuck)
    if (wet(step.offset(0, 1, 0)) || wet(step.offset(0, 2, 0))) return false;
    // The bottom step is paved from its forward tunnel: none dug yet (or
    // blocked), nothing to stand on to pave it, so it isn't counted (review:
    // it could never be done, and held the mine stage up)
    if (i === rec.stairs - 1) return bot.blockAt(step.plus(STEP[dirAt(rec.direction, i, rec.turns)]))?.boundingBox === "empty";
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
/**
 * At home: the stair blocks its bare steps need (and 10% spare) made at the
 * table, from its chests' cobblestone, ready for the next trip down.
 */
export async function makeStairBlocks(): Promise<void> {
  const rec = mineRecord();
  if (!rec?.bottom) return;
  const want = stairsToMake(unpavedSteps().length);
  if (want === 0 || carried(["cobblestone_stairs"]) >= want) return;
  const { storedNear, takeItems } = await import("../actions/storage");
  // Ones it has stored already first
  if (storedNear("cobblestone_stairs", 32) > 0) await takeItems([{ name: "cobblestone_stairs", count: want - carried(["cobblestone_stairs"]) }], true);
  if (carried(["cobblestone_stairs"]) >= want) return;
  const cobble = Math.ceil((want - carried(["cobblestone_stairs"])) / 4) * 6;
  // Once 200 have piled up (owner), and its building stock stays
  const owned = carried(["cobblestone"]) + storedNear("cobblestone", 32);
  if (owned < 200 || owned < cobble + 32) return;
  if (carried(["cobblestone"]) < cobble + 32) await takeItems([{ name: "cobblestone", count: cobble }], true);
  const { acquire } = await import("./acquire");
  const { liveWorld } = await import("./world");
  if ((await acquire("cobblestone_stairs", want, liveWorld)).ok) console.log(`Home: made ${carried(["cobblestone_stairs"])} cobblestone stairs for ${unpavedSteps().length} bare steps.`);
}

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

async function paveSteps(fromBag = false): Promise<ActionResult> {
  const rec = mineRecord();
  if (!rec?.bottom) return fail("not_found", "no mine yet");
  const steps = unpavedSteps();
  if (steps.length === 0) return ok();
  if (fromBag && carried(["cobblestone_stairs"]) === 0) return ok();
  // Counted first: every bare step plus 10% spare (a stair placed wrong, a
  // step that breaks), all made at home before it goes down (owner; game
  // test: it tried crafting them down in the mine, where it couldn't reach a
  // table, and paved nothing)
  const want = stairsToMake(steps.length);
  const have = carried(["cobblestone_stairs"]);
  // On its way down with the blocks its home chores made: paved with those, no trip back for more
  if (have < want && !fromBag) {
    // Deep down: not a climb home just for them (game test: from the bottom
    // of its mine it climbed into flooded steps for them and drowned); its
    // home chores make them, and the stairs are paved next time
    if (have === 0 && bot.entity.position.y < rec.start.y - 12) return fail("missing_items", "my stair blocks are made at home first; paving next time I'm up there");
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
    const step = stepAt(rec.start, rec.direction, i, rec.turns);
    // Placed facing up the stairs: from the step below, or (the bottom step)
    // from its forward tunnel, which is level with it
    const stand = i + 1 < rec.stairs ? stepAt(rec.start, rec.direction, i + 1, rec.turns) : step.plus(STEP[dirAt(rec.direction, i, rec.turns)]);
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
      for (const side of [STEP[armDirection("right", dirAt(rec.direction, i, rec.turns))], STEP[armDirection("left", dirAt(rec.direction, i, rec.turns))]]) {
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

// Coal it wants before it stops going deeper early (torches, owner)
export const IRON_TRIP_COAL = 32;

/**
 * True when a floor is done enough to go on down: a sleeve finished (or
 * stopped) and still short of iron for its iron pickaxe and sword, or of
 * coal (owner). Pure.
 */
export function goDeeperEarly(arms: Arms, ironHave: number, ironNeed: number, coalHave: number): boolean {
  const oneDone = ARMS.some((a) => sleeveFinished(arms[a]) && pokesTodo(arms[a]).length === 0);
  return oneDone && (ironHave < ironNeed || coalHave < IRON_TRIP_COAL);
}

// Diamonds are most common deep down (around y -58): a diamond trip on a
// floor above this goes on down once a tunnel there is done
export const DIAMOND_FLOOR_Y = -40;

/** True when a diamond trip goes on down from this floor (hub at `hubY`): a tunnel done, and the floor above DIAMOND_FLOOR_Y. Pure. */
export function diamondsDeeper(arms: Arms, hubY: number): boolean {
  return hubY > DIAMOND_FLOOR_Y && ARMS.some((a) => sleeveFinished(arms[a]) && pokesTodo(arms[a]).length === 0);
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
// Health under which a trip in progress is ended and it climbs out
const LEAVE_HURT_UNDER = 10;
const hurtInTheMine = (): boolean => (bot.health ?? 20) < LEAVE_HURT_UNDER;
async function leaveHurt(): Promise<ActionResult> {
  report(`I'm hurt (health ${Math.round(bot.health ?? 0)} of 20): out of the mine to heal.`);
  await upFromTheMine();
  return fail("refused", `I'm hurt (health ${Math.round(bot.health ?? 0)} of 20); healing before I go down the mine`);
}
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
// Sleeve columns whose pokeholes it digs in one pass (then the ore and the floor)
const POKES_PER_PASS = 2;

/**
 * Both pokeholes off sleeve column `k` (1 wide, 3 high, 5 long, owner),
 * their caves sealed. `sleeveLen`: how far the sleeve is dug (its own).
 */
async function digPokesAt(base: Vec3, way: DirectionType, k: number, sleeveLen: number): Promise<"ok" | "no_tool" | "hurt" | "stopped"> {
  const cell = base.plus(STEP[way].scaled(k));
  for (const sd of POKE_SIDES) {
    if (isCommandCancelled()) return "stopped";
    const across = sd === 1 ? RIGHT[way] : LEFT[way];
    if (!(await goToStep(cell)).ok) break;
    // A cave met on the way: the pokehole ends there, plugged (a finished pokehole)
    await digStraightTunnel(across, POKE_LENGTH, cell, 1, POKE_HEIGHT, caveHooks("poke", across, POKE_HEIGHT));
    if (tunnelStopReason() === "no_tool") return "no_tool";
    // Its tip (and floor) where it opened into a cave: sealed (owner)
    // (as far as it really goes: one that stopped at a cave ends at its plug)
    const pokeCells: Vec3[] = [];
    for (let q = 1; q <= POKE_LENGTH; q++) {
      const c = cell.plus(STEP[across].scaled(q));
      if (bot.blockAt(c)?.boundingBox !== "empty") break;
      for (let dy = 0; dy < POKE_HEIGHT; dy++) pokeCells.push(c.offset(0, dy, 0));
    }
    const sleeveCells: Vec3[] = [];
    for (let q = 1; q <= sleeveLen; q++) for (let dy = 0; dy < SLEEVE_HEIGHT; dy++) sleeveCells.push(base.plus(STEP[way].scaled(q)).offset(0, dy, 0));
    await sealPokeCaves(pokeCells, sleeveCells);
    await minePocketsLeft();
    if (hurtInTheMine()) return "hurt";
  }
  return "ok";
}

export async function branchMine(wants: OreWant[], chunksThisTrip = 12): Promise<ActionResult> {
  return withScaffoldingTakenDown(() => branchMineSteps(wants, chunksThisTrip));
}

async function branchMineSteps(wants: OreWant[], tripChunks: number): Promise<ActionResult> {
  const first = myMine();
  if (!first) return fail("not_found", "no mine yet");
  // Its pickaxe lost (a death) or worn out: a stone one made first, from the
  // cobblestone it carries or keeps (game test: back from a death with no
  // tools, every coal and iron trip was refused, "I have none yet", while
  // its stone tools counted as done)
  // Spares for the trip (owner: craft them in bulk, 3 in the bag; one stone
  // pickaxe lasts about 3 minutes of tunnelling, and it walked to a table
  // for each new one)
  if (pickaxesForTrip() < SPARE_PICKAXES && toolTier("pickaxe") < TIER.iron) {
    const { acquire } = await import("./acquire");
    const { liveWorld } = await import("./world");
    const spares = await acquire("stone_pickaxe", SPARE_PICKAXES, liveWorld);
    if (!spares.ok) console.log(`Mine: ${pickaxesForTrip()} pickaxe${pickaxesForTrip() === 1 ? "" : "s"} for the trip (${describeFailure(spares)}).`);
  }
  if (!hasStonePickaxe()) {
    const { acquire } = await import("./acquire");
    const { liveWorld } = await import("./world");
    const made = await acquire("stone_pickaxe", 1, liveWorld);
    if (!made.ok) return fail("no_tool", `I mine with a stone pickaxe, and I couldn't make one (${describeFailure(made)})`);
    if (!hasStonePickaxe()) return fail("no_tool", "I mine with a stone pickaxe, and I have none yet");
  }
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

  // Its stairs whole first, floor, walls and roof (owner: "the stairs must be
  // ensured as hell; the most important thing in this mine"): a second go
  // after getting more to build with, then no mining below open stairs
  if ((await lookAfterStairs()) > 0) {
    const open = await lookAfterStairs();
    if (isCommandCancelled()) return fail("aborted", "stopped");
    if (open > 0) return fail("refused", `my mine's stairs aren't whole yet (${open} open blocks of floor, wall or roof); no mining below them till they are`);
  }
  // Its stairs paved on the way down with the stair blocks it carries: its
  // home chores make them, and the paving milestone, among the last of its
  // own life, never comes up while it has plans
  if (carried(["cobblestone_stairs"]) > 0 && unpavedSteps().length > 0) {
    await withScaffoldingTakenDown(() => paveSteps(true));
    if (isCommandCancelled()) return fail("aborted", "stopped");
  }
  await lookAfterFloors(); // ways in from outside blocked, leftovers out, uncovered ore mined
  leftSaid = new Set(); // ore it can't mine yet: said again on this trip
  let refilled = false; // once a trip: stone from the walls when it has nothing to build with
  for (let chunk = 0; chunk < tripChunks && still().length > 0; chunk++) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    // Hurt down there: the trip ends and it goes up (game test: at 7 health,
    // skeletons and a zombie round it, it ate and dug on, and died)
    if (hurtInTheMine()) return leaveHurt();
    const rec = mineRecord()!;
    const { start, direction: dir } = rec;
    let { level, arms } = rec;
    let arm = nextArm(arms);
    // Owner (2026-11-27): one sleeve dug on this floor and still short of
    // iron for a pickaxe and a sword (or 32 coal for torches): on down to the
    // next floor (iron is scarce up high) rather than finishing every sleeve
    if (arm && !rec.exhausted && !rec.deepest && level + 1 < MAX_LEVELS && stepAt(start, dir, hubStep(level + 1), rec.turns).y >= MIN_HUB_Y) {
      const { owned } = await import("./milestones");
      const ironNeed = (toolTier("pickaxe") < TIER.iron ? 3 : 0) + (toolTier("sword") < TIER.iron ? 2 : 0);
      const hubY = stepAt(start, dir, hubStep(level), rec.turns).y;
      if (goDeeperEarly(arms, owned(["raw_iron", "iron_ingot"]), ironNeed, owned(["coal", "charcoal"]))) {
        report(`A tunnel is done on this floor and I'm still short of iron for a pickaxe and a sword (or coal for torches): on down to the next floor.`);
        arm = null;
      } else if (wants.some((w) => w.item === "diamond") && diamondsDeeper(arms, hubY)) {
        report(`A tunnel is done on this floor and diamonds lie deeper: on down to the next floor.`);
        arm = null;
      }
    }
    // All three tunnels at this hub done: 20 steps further down, a new hub
    if (!arm) {
      // As deep as it goes (just over bedrock, or every way down blocked):
      // side tunnels off its lowest level's tunnels instead (owner: every 3
      // blocks a side route of 10)
      if (rec.exhausted || level + 1 >= MAX_LEVELS || stepAt(start, dir, hubStep(level + 1), rec.turns).y < MIN_HUB_Y) {
        const side = await digSideRoute(rec, level);
        if (side === "all_done") return fail("not_found", `my mine's lowest level is dug out with side tunnels (no way deeper), and I still have too little ${stillNames()}`);
        if (side === "no_tool") return fail("no_tool", "my pickaxe wore out in the mine");
        if (isCommandCancelled()) return fail("aborted", "stopped");
        await mineOresInSight(wants);
        continue;
      }
      // Its stairs were blocked going deeper: tried again after a while, not
      // never (game test: gravel fell in, "no path" to the next block, and
      // with one level of tunnels its mine was done for good: no iron, ever)
      if (rec.deepest && Date.now() < stairsBlockedUntil) return fail("not_found", `my mine's stairs were blocked going deeper; I'll dig on later (still too little ${stillNames()})`);
      // Blocked going down last time (a mine from before turns, or after a
      // restart): turned at once, never down the same flooded way again
      if (rec.deepest) {
        const blockedWay = dirAt(dir, Math.max(rec.stairs, hubStep(level) + 1), rec.turns);
        if (await turnStairs(rec, level, blockedWay, "water, lava or something built last time")) continue;
        // Never back down the blocked way: every way tried (said for good), or the cap next trip
        if (!planTurn(rec, level, blockedWay)) {
          // Every way down blocked: side tunnels at this level from now on
          report("Every way down from my mine's crossroads is blocked; I'll dig side tunnels off my lowest level instead.");
          await saveMine(start, dir, rec.stairs, rec.branches, rec.bottom, { level, arms: rec.arms, deepest: true, exhausted: true });
          continue;
        }
        stairsBlockedUntil = Date.now() + STAIRS_RETRY_MS;
        return fail("unreachable", `I couldn't cap my blocked mine stairs yet; I'll turn them next trip (still too little ${stillNames()})`);
      }
      level += 1;
      arms = freshArms();
      report(`My mine's tunnels here are done; digging the stairs ${LEVEL_STEP} steps deeper.`);
      const deeper = await digStairsTo(rec, hubStep(level));
      if (!deeper.ok) {
        if (deeper.reason !== "refused") return deeper;
        // Blocked (water, lava, the sea, something built): back to the
        // crossroad it came down from and new stairs from there, to the
        // right, then the left; both blocked, one crossroad higher (owner)
        const now = mineRecord() ?? rec;
        const turned = await turnStairs(now, level - 1, dirAt(dir, now.stairs, now.turns), deeper.detail);
        if (turned) continue;
        // Blocked every way from every crossroad (and remembered, review:
        // it went back down to the flood every 15 minutes), or a cap it
        // couldn't put in yet (tried again next trip)
        stairsBlockedUntil = Date.now() + STAIRS_RETRY_MS;
        const left = nextTurn(now.direction, now.turns, now.tried, level - 1, dirAt(dir, now.stairs, now.turns)) !== null;
        await saveMine(start, dir, now.stairs, rec.branches, rec.bottom, { level: level - 1, arms: rec.arms, deepest: true, exhausted: !left });
        // Every way down blocked: side tunnels at the lowest level from now on (owner)
        if (!left) {
          report("Every way down from my mine's crossroads is blocked; I'll dig side tunnels off my lowest level instead.");
          continue;
        }
        return fail("not_found", `I couldn't cap my blocked mine stairs yet (${deeper.detail}); I'll turn them next trip (still too little ${stillNames()})`);
      }
      await saveMine(start, dir, hubStep(level) + 1, rec.branches, rec.bottom, { level, arms, deepest: false });
      arm = nextArm(arms)!;
    }
    // Down to where this tunnel ends now, then on a few blocks
    const hub = stepAt(start, dir, hubStep(level), rec.turns);
    const arrive = dirAt(dir, hubStep(level), rec.turns);
    // The floor's room and its sign first (owner)
    const recNow = mineRecord() ?? rec;
    const side = roomBeside(level, recNow.sideFrom);
    if (recNow.roomsDone < level) {
      await digFloorRoom(hub, arrive, level, side);
      if (isCommandCancelled()) return fail("aborted", "stopped");
      await saveMine(start, dir, Math.max(recNow.stairs, hubStep(level) + 1), recNow.branches, recNow.bottom, { level, arms, deepest: recNow.deepest, roomsDone: level });
    }
    // Its crafting table and furnace in the room's corners (once a trip per floor)
    if (!furnishedSeen.has(level)) {
      furnishedSeen.add(level);
      await furnishFloor(hub, arrive, level);
      if (isCommandCancelled()) return fail("aborted", "stopped");
      await sealRoomCaves(hub, arrive, level);
      if (isCommandCancelled()) return fail("aborted", "stopped");
    }
    // The floor's sleeves go by the way its stairs came in (owner's plan)
    const way = armDirection(arm, arrive);
    const base = sleeveBase(hub, arrive, arm);
    // The sleeve dug its whole length first, then its pokeholes, from the far
    // end back toward the room (owner, 2026-11-28: more productive)
    if (sleeveFinished(arms[arm])) {
      for (const k of pokesTodo(arms[arm]).slice(0, POKES_PER_PASS)) {
        if (isCommandCancelled()) return fail("aborted", "stopped");
        const r = await digPokesAt(base, way, k, arms[arm].dug);
        if (r === "no_tool") return fail("no_tool", "my pickaxe wore out in the mine");
        if (r === "stopped") return fail("aborted", "stopped");
        arms = { ...arms, [arm]: armPokedAt(arms[arm], k) };
        await saveMine(start, dir, Math.max(rec.stairs, hubStep(level) + 1), rec.branches, rec.bottom, { level, arms, deepest: rec.deepest });
        if (r === "hurt") return leaveHurt();
      }
      if (pokesTodo(arms[arm]).length === 0) chatter(`My ${arm} tunnel's pokeholes are dug; on with the next one.`, "mining");
      await mendFloor(hub, arrive, level, side);
      await lookAfterFloors();
      await minePocketsLeft();
      if (hurtInTheMine()) return leaveHurt();
      await mineOresInSight(wants);
      await mendFloor(hub, arrive, level, side);
      continue;
    }
    const end = base.plus(STEP[way].scaled(arms[arm].dug));
    let there = await goToStep(end);
    // Gravel or sand fallen into the tunnel: dug out (a walk can't dig a block
    // with gravel over it, game test: a 2-high gravel fall at the forward
    // sleeve's end, and the whole tunnel was given up as done), then again
    if (!there.ok && !isCommandCancelled() && (await digOutFallen(base, way, arms[arm].dug)) > 0) there = await goToStep(end);
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
      arms = { ...arms, [arm]: { ...arms[arm], blocked: true } };
      await saveMine(start, dir, Math.max(rec.stairs, hubStep(level) + 1), rec.branches, rec.bottom, { level, arms, deepest: rec.deepest });
      continue;
    }
    const length = Math.min(CHUNK, ARM_LENGTH - arms[arm].dug);
    const dug = await digStraightTunnel(way, length, end, 1, SLEEVE_HEIGHT, caveHooks("sleeve", way, SLEEVE_HEIGHT));
    const stop = dug ? null : tunnelStopReason();
    // A big cave ahead: the sleeve ends at it (its face plugged), as far as it got
    const got = dug ? length : stop === "cave" ? tunnelColumns() : 0;
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
    // Its pokeholes wait for the whole sleeve (owner, 2026-11-28)
    arms = { ...arms, [arm]: dug ? armAfterStretch(arms[arm], arms[arm].dug + length, false) : armAfterStretch(arms[arm], arms[arm].dug + got, true) };
    // A tunnel stopped by water, lava or something built: new stairs never
    // turn that way from this hub (owner: they'd dig into the same water)
    let tried = rec.tried;
    if (!dug && stop === "blocked") {
      const h = String(hubStep(level));
      tried = { ...rec.tried, [h]: [...new Set([...(rec.tried[h] ?? []), way])] };
    }
    const what = stop === "cave" ? "a big cave (its way in plugged)" : stop === "drop" ? "a drop I couldn't build a floor over" : stop === "no_filler" ? "a hole I had nothing to fill" : "water, lava or something it mustn't dig";
    const then = pokesTodo(arms[arm]).length > 0 ? "now its pokeholes, from the far end back" : "on with the next one";
    if (!dug) chatter(`My ${arm} tunnel ${level ? `${level + 1} levels down ` : ""}hit ${what}; ${then}.`, "mining");
    else if (arms[arm].dug >= ARM_LENGTH) chatter(`My ${arm} tunnel is ${ARM_LENGTH} blocks long; ${then}.`, "mining");
    await saveMine(start, dir, Math.max(rec.stairs, hubStep(level) + 1), rec.branches, rec.bottom, { level, arms, deepest: rec.deepest, tried });
    // The stretch secured first (owner: every ore seen mined at once, but
    // only once the area is secured): its floor mended, a way out to the sky
    // blocked; then the ore it uncovered and the ore in sight
    await mendFloor(hub, arrive, level, side);
    await lookAfterFloors();
    await minePocketsLeft();
    if (hurtInTheMine()) return leaveHurt();
    await mineOresInSight(wants);
    await mendFloor(hub, arrive, level, side);
  }
  // A heavy bag goes home with it (owner: it died in the mine carrying 1022 things)
  await haulHomeIfHeavy();
  return still().length === 0 ? ok() : fail("missing_items", `not enough ${stillNames()} yet (I'll mine on next time)`);
}

/**
 * The floor under a floor's open space mended near the bot (owner: an ore
 * dug out under a sleeve or a pokehole leaves a hole; the floor is
 * recovered): every cell under its room, sleeves and pokeholes within
 * MEND_RANGE that isn't solid gets dirt or cobblestone, the stairs going on
 * down excepted. Best effort.
 */
const MEND_RANGE = 8;
/** The room's and sleeves' floor mended on every floor of its mine near it (after gathering ore out of a tunnel, owner). */
export async function mendMineFloors(): Promise<void> {
  const rec = mineRecord();
  if (!rec) return;
  for (let l = 0; l <= rec.level && hubStep(l) < rec.stairs; l++) {
    if (isCommandCancelled()) return;
    const h = hubStep(l);
    await mendFloor(stepAt(rec.start, rec.direction, h, rec.turns), dirAt(rec.direction, h, rec.turns), l, roomBeside(l, rec.sideFrom));
  }
}

async function mendFloor(hub: Vec3, arrive: DirectionType, level: number, side: boolean): Promise<void> {
  const rec = mineRecord();
  // As far as it has dug (never the plan beyond: a planned sleeve over a lake)
  const dugTo = rec && level === rec.level
    ? Object.fromEntries(ARMS.map((a) => [a, rec.arms[a].dug]))
    : Object.fromEntries(ARMS.map((a) => [a, openRun(sleeveBase(hub, arrive, a), armDirection(a, arrive))]));
  const open = floorCells(hub, arrive, level, side, dugTo);
  const openSet = new Set(open.map((c) => c.toString()));
  const stairs = rec ? new Set(mineStairCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom).walk.map((c) => c.toString())) : new Set<string>();
  const here = bot.entity.position;
  const { isHoleBlock, ensureBlock } = await import("../actions/digging");
  const keepClear = (p: Vec3): boolean => openSet.has(p.toString()) || stairs.has(p.toString());
  let mended = 0;
  // Blocks it left standing in the floor's tunnels (footholds a walk put
  // down): taken out first (owner: weird blocks in the shafts)
  const { isOwnScaffold } = await import("../core/scaffold");
  const { breakBlock } = await import("../core/primitives");
  let cleared = 0;
  for (const c of open) {
    if (isCommandCancelled()) return;
    if (c.distanceTo(here) > MEND_RANGE || !isOwnScaffold(c)) continue;
    if ((await breakBlock(c)).ok) cleared++;
  }
  if (cleared > 0) console.log(`Mine: took ${cleared} block${cleared === 1 ? "" : "s"} I'd left standing out of the ${floorName(level)}'s tunnels.`);
  // The room's and the sleeves' floor only (owner: pokeholes aren't
  // restored, nor any roof)
  for (const c of floorCells(hub, arrive, level, side, dugTo, false)) {
    if (c.y !== hub.y || isCommandCancelled()) continue;
    const under = c.offset(0, -1, 0);
    if (keepClear(under) || under.distanceTo(here) > MEND_RANGE) continue;
    if (!isHoleBlock(bot.blockAt(under))) continue;
    if (await ensureBlock(under, keepClear)) mended++;
  }
  if (mended > 0) console.log(`Mine: mended ${mended} hole${mended === 1 ? "" : "s"} in the ${floorName(level)}'s floor.`);
}

/**
 * A floor's room (owner): 3 by 3 round its stairs, 3 high, a floor under it
 * (the stairs going on down excepted), and a sign on its wall: "1st floor",
 * "2nd floor"... Best effort: a block it can't dig or a sign it can't make
 * doesn't stop the mining.
 */
async function digFloorRoom(hub: Vec3, arrive: DirectionType, level: number, _side = true): Promise<void> {
  if (!(await goToStep(hub)).ok) return;
  const R = STEP[RIGHT[arrive]];
  const F = STEP[arrive];
  const { breakBlock } = await import("../core/primitives");
  const { ensureBlock } = await import("../actions/digging");
  const room: Vec3[] = [];
  // Ahead of the stairs' end, 3 by 3 (owner's plan); the stairs cross it flat
  for (const [a, b] of ROOM_CELLS) room.push(hub.plus(R.scaled(a)).plus(F.scaled(b)));
  const inRoom = (p: Vec3): boolean => room.some((c) => c.x === p.x && c.z === p.z && p.y >= c.y && p.y < c.y + ROOM_HEIGHT);
  let dug = 0;
  for (const c of room) {
    for (let dy = ROOM_HEIGHT - 1; dy >= 0; dy--) {
      if (isCommandCancelled()) return;
      const cell = c.offset(0, dy, 0);
      const b = bot.blockAt(cell);
      if (!b || b.boundingBox !== "block" || b.name.endsWith("_stairs")) continue;
      if ((await breakBlock(cell)).ok) dug++;
    }
    // Its floor (the stairs go on down beyond its front side)
    await ensureBlock(c.offset(0, -1, 0), inRoom);
  }
  console.log(`Mine: the ${floorName(level)}'s room dug (${dug} blocks).`);
  // Its sign on the room's right wall by the back corner, at eye height
  const planks = bot.inventory.items().filter((i) => i.name.endsWith("_planks")).sort((a, b) => b.count - a.count)[0];
  const sign = planks ? `${planks.name.replace(/_planks$/, "")}_sign` : "oak_sign";
  if (!bot.inventory.items().some((i) => i.name.endsWith("_sign"))) {
    const { acquire } = await import("./acquire");
    const { liveWorld } = await import("./world");
    await acquire(sign, 1, liveWorld);
  }
  const have = bot.inventory.items().find((i) => i.name.endsWith("_sign"))?.name;
  if (!have) return;
  const spot = hub.plus(R).offset(0, 1, 0);
  const { placeBlockResult } = await import("../actions/blockPlacing");
  const placed = await placeBlockResult(have, spot.x, spot.y, spot.z, RIGHT[arrive]);
  if (!placed.ok) return;
  const { writeSign } = await import("../core/primitives");
  const wrote = await writeSign(spot, floorName(level));
  if (wrote.ok) chatter(`The ${floorName(level)} of my mine has its room and its sign.`, "mining");
}

// Floors whose table and furnace it looked at since it connected (one it
// couldn't put in isn't tried again on every tunnel)
const furnishedSeen = new Set<number>();

/**
 * The floor's crafting table and furnace in its room's corners (owner: a
 * crafting table on every floor, and a furnace): it crafts and smelts down
 * there instead of going home. Made from what it carries if it has none.
 * Best effort: none doesn't stop the mining.
 */
async function furnishFloor(hub: Vec3, arrive: DirectionType, level: number): Promise<void> {
  const put: string[] = [];
  // Never in its stairs (turned through the room): moved to the room's forward middle
  const rec = mineRecord();
  const stairs = rec ? new Set(mineStairCells(rec.start, rec.direction, rec.stairs, rec.level, rec.turns, rec.sideFrom).walk.map((c) => c.toString())) : new Set<string>();
  const inStairs = (p: Vec3): boolean => stairs.has(p.toString());
  for (const [item, usual] of [["crafting_table", floorTableSpot(hub, arrive)], ["furnace", floorFurnaceSpot(hub, arrive)]] as const) {
    if (isCommandCancelled()) return;
    const spot = furnitureSpot(usual, hub, arrive, inStairs);
    if (!spot) continue;
    const there = bot.blockAt(spot);
    if (!there || there.name === item) continue;
    // Something else it or the owner put there: left alone
    if (there.boundingBox === "block" && !isNatural(there.name)) continue;
    if (!bot.inventory.items().some((i) => i.name === item)) {
      const { acquire } = await import("./acquire");
      const { liveWorld } = await import("./world");
      const made = await acquire(item, 1, liveWorld);
      if (!made.ok) {
        console.log(`Mine: no ${item.replace(/_/g, " ")} for the ${floorName(level)} (${made.detail ?? made.reason}).`);
        continue;
      }
    }
    const { placeBlockResult } = await import("../actions/blockPlacing");
    const placed = await placeBlockResult(item, spot.x, spot.y, spot.z, "bottom");
    if (!placed.ok) continue;
    const { saveCraftingTableLocation, saveFurnaceLocation } = await import("../managers/persistenceManager");
    await (item === "crafting_table" ? saveCraftingTableLocation(spot) : saveFurnaceLocation(spot));
    put.push(item === "crafting_table" ? "a crafting table" : "a furnace");
  }
  if (put.length > 0) chatter(`Put ${put.join(" and ")} in the ${floorName(level)}'s room of my mine.`, "mining");
}

// Side routes off the lowest level's tunnels (owner): every 3 blocks, 10 long
const SIDE_EVERY = 3;
const SIDE_LENGTH = 10;
export type SideRoute = { arm: ArmName; at: number; side: "right" | "left" };

/** The side routes off a hub's three tunnels, in the order they're dug. Pure. */
export function sideRoutes(): SideRoute[] {
  const out: SideRoute[] = [];
  for (const arm of ARMS) for (let at = SIDE_EVERY; at <= ARM_LENGTH; at += SIDE_EVERY) for (const side of ["right", "left"] as const) out.push({ arm, at, side });
  return out;
}

/**
 * The next side route off its lowest hub's tunnels: walked to where it leaves
 * the tunnel (a tunnel that ends sooner: skipped) and dug 10 blocks, mining
 * what it uncovers. Remembered one by one.
 */
async function digSideRoute(rec: MineRecord, level: number): Promise<"dug" | "skipped" | "all_done" | "no_tool"> {
  const routes = sideRoutes();
  const i = rec.sidesDone;
  if (i >= routes.length) return "all_done";
  const r = routes[i]!;
  const h = hubStep(level);
  const way = armDirection(r.arm, dirAt(rec.direction, h, rec.turns));
  const from = stepAt(rec.start, rec.direction, h, rec.turns).plus(STEP[way].scaled(r.at));
  const save = (): Promise<void> => saveMine(rec.start, rec.direction, rec.stairs, rec.branches, rec.bottom, { level, arms: rec.arms, deepest: rec.deepest, sidesDone: i + 1 });
  // The tunnel doesn't reach that far (or is blocked there): on with the next
  if (bot.blockAt(from)?.boundingBox !== "empty" || !(await goToStep(from)).ok) {
    if (!isCommandCancelled()) await save();
    return "skipped";
  }
  const sideWay = armDirection(r.side, way);
  if (i === 0) report(`Side tunnels off my mine's lowest level: one every ${SIDE_EVERY} blocks, ${SIDE_LENGTH} long.`);
  const dug = await digStraightTunnel(sideWay, SIDE_LENGTH, from, 1);
  if (!dug && tunnelStopReason() === "no_tool") return "no_tool";
  if (isCommandCancelled()) return "skipped";
  await save();
  return "dug";
}

/**
 * The next way for blocked stairs (owner): from the crossroad they came down
 * from, to the right of the way the stairs came in, then the left; with both
 * tried, the same one crossroad higher, and so on up. `fromLevel` is the hub
 * the blocked stairs left; `blocked` the way they went. Null when every way
 * from every hub is tried. Pure.
 */
export function nextTurn(dir: DirectionType, turns: Turn[], tried: Record<string, DirectionType[]>, fromLevel: number, blocked: DirectionType): { level: number; dir: DirectionType; out: DirectionType } | null {
  for (let L = fromLevel; L >= 0; L--) {
    const h = hubStep(L);
    const arrive = dirAt(dir, h, turns);
    // The way it went down from this hub: blocked (the deepest), or the way to the blocked one
    const out = L === fromLevel ? blocked : dirAt(dir, h + 1, turns);
    const done = new Set([...(tried[String(h)] ?? []), out]);
    const pick = [RIGHT[arrive], LEFT[arrive]].find((d) => !done.has(d));
    if (pick) return { level: L, dir: pick, out };
  }
  return null;
}

// Every tunnel at a hub counted done: the stairs go on down from it at once
const doneArms = (): Arms => ({ forward: { dug: ARM_LENGTH, blocked: true }, right: { dug: ARM_LENGTH, blocked: true }, left: { dug: ARM_LENGTH, blocked: true }, back: { dug: ARM_LENGTH, blocked: true } });

/** What a turn changes in the mine record. */
export type TurnPlan = { level: number; dir: DirectionType; out: DirectionType; hubAt: number; stairs: number; turns: Turn[]; tried: Record<string, DirectionType[]> };

/**
 * The record after turning blocked stairs (owner's rule, `nextTurn`): the
 * stairs end at that hub, the new way recorded from it, what was tried
 * there kept (and forgotten for hubs below it, which move). Null when every
 * way is tried. Pure.
 */
export function planTurn(rec: { direction: DirectionType; turns: Turn[]; tried: Record<string, DirectionType[]> }, fromLevel: number, blocked: DirectionType): TurnPlan | null {
  const next = nextTurn(rec.direction, rec.turns, rec.tried, fromLevel, blocked);
  if (!next) return null;
  const h = hubStep(next.level);
  const tried: Record<string, DirectionType[]> = {};
  for (const [k, v] of Object.entries(rec.tried)) if (Number(k) < h) tried[k] = v;
  tried[String(h)] = [...new Set([...(rec.tried[String(h)] ?? []), next.out, next.dir])];
  return { ...next, hubAt: h, stairs: h + 1, turns: rec.turns.filter((t) => t.at < h).concat({ at: h, dir: next.dir }), tried };
}

/**
 * Turns its blocked stairs (owner): the old way down from the hub capped,
 * the record moved to the new stairs. True when it turned; false when every
 * way is tried, or the cap couldn't go in yet (tried again next trip: a
 * turn with an open hole down to the flood is no turn).
 */
async function turnStairs(rec: MineRecord, fromLevel: number, blocked: DirectionType, why: string): Promise<boolean> {
  const plan = planTurn(rec, fromLevel, blocked);
  if (!plan) return false;
  const hub = stepAt(rec.start, rec.direction, plan.hubAt, rec.turns);
  const capped = await capTunnelFloor(hub, plan.out);
  if (!capped.ok) {
    console.log(`Mine: couldn't cap my old stairs going ${plan.out} at ${hub} (${capped.why}); turning next trip.`);
    return false;
  }
  const side = plan.dir === RIGHT[dirAt(rec.direction, plan.hubAt, rec.turns)] ? "right" : "left";
  report(`My mine's stairs hit ${why}; I capped them off and I'm starting new stairs to the ${side} from the crossroad ${plan.level + 1} level${plan.level === 0 ? "" : "s"} down.`);
  const seals = [...rec.seals, ...capped.cells.map((c) => ({ x: c.x, y: c.y, z: c.z }))];
  await saveMine(rec.start, rec.direction, plan.stairs, rec.branches, rec.bottom, { level: plan.level, arms: doneArms(), deepest: false, turns: plan.turns, tried: plan.tried, seals, exhausted: false, roomsDone: Math.min(rec.roomsDone, plan.level) });
  return true;
}

/**
 * Caps the floor of the tunnel at `hub` going `way` (review): the old stairs
 * down that way took out its floor for 4 blocks; a block in each, placed
 * from the hub and then standing on the last one, cuts them off from the
 * tunnel. Never from below (it would wall itself in next to the water).
 */
async function capTunnelFloor(hub: Vec3, way: DirectionType): Promise<{ ok: boolean; cells: Vec3[]; why: string }> {
  const cells = [1, 2, 3, 4].map((k) => hub.plus(STEP[way].scaled(k)).offset(0, -1, 0));
  const solid = (c: Vec3): boolean => bot.blockAt(c)?.boundingBox === "block";
  const at = await goToStep(hub);
  if (!at.ok) {
    // What's there, to see why (game test: "no path" to the crossroad twice)
    const name = (p: Vec3): string => bot.blockAt(p)?.name ?? "?";
    console.log(`Mine: crossroad ${hub}: feet ${name(hub)}, head ${name(hub.offset(0, 1, 0))}, floor ${name(hub.offset(0, -1, 0))}; I'm at ${bot.entity.position.floored()}.`);
    return { ok: false, cells, why: `can't get to the crossroad: ${describeFailure(at)}` };
  }
  if (bot.entity.position.y < hub.y - 0.5) return { ok: false, cells, why: "I'm below the crossroad" };
  const { placeBlockResult } = await import("../actions/blockPlacing");
  for (let k = 0; k < cells.length; k++) {
    if (isCommandCancelled()) return { ok: false, cells, why: "stopped" };
    const c = cells[k]!;
    if (!solid(c)) {
      const filler = ["cobblestone", "cobbled_deepslate", "stone", "dirt"].find((n) => carried([n]) > 0);
      if (!filler) return { ok: false, cells, why: "nothing to cap it with" };
      await placeBlockResult(filler, c.x, c.y, c.z, "side");
      if (!solid(c)) return { ok: false, cells, why: `the block at ${c} didn't go in` };
    }
    // On to it, for the next (best effort: the next may be in reach from here)
    if (k < cells.length - 1) await goTo(new pf.goals.GoalBlock(c.x, c.y + 1, c.z));
  }
  console.log(`Mine: capped the tunnel floor over my old stairs going ${way} from ${hub}.`);
  return { ok: true, cells, why: "" };
}

/**
 * Water or lava in a step's walking space or right against it (its sides,
 * floor and roof), or null. Pure over `look`.
 */
export function liquidAtStep(s: Pos, look: (x: number, y: number, z: number) => string | null): string | null {
  for (let dy = -1; dy <= STAIR_HEADROOM + 1; dy++) {
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const name = look(s.x + dx, s.y + dy, s.z + dz);
      if (name === "water" || name === "lava" || name === "bubble_column") return name === "bubble_column" ? "water" : name;
    }
  }
  return null;
}

/** The live check. */
const stepLiquid = (s: Vec3): string | null => liquidAtStep(s, (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name ?? null);

/**
 * Digs the mine's stairs on down to step `to` (a step at a time, from where
 * they end now), remembering each one. A blocked step stops it.
 */
async function digStairsTo(rec: MineRecord, to: number): Promise<ActionResult> {
  const { start, direction: dir } = rec;
  const from = Math.max(rec.stairs, 1);
  const top = stepAt(start, dir, from - 1, rec.turns);
  const atTop = await goToStep(top);
  // Not there (a walk that failed, a stop): try again next trip; never "as deep as it goes"
  if (!atTop.ok) return fail(atTop.reason === "aborted" ? "aborted" : "unreachable", atTop.detail);
  for (let i = from; i <= to; i++) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    // Water or lava at this step: a blocker for its stairs, never plugged and
    // dug past (owner: turn at water; plugged, its deepest stairs ran
    // through a flooded cave and it kept ending up under water)
    const liquid = stepLiquid(stepAt(start, dir, i, rec.turns));
    if (liquid) return fail("refused", `${liquid} at the next step`);
    if (!(await digDiagonalTunnel(dirAt(dir, i, rec.turns), 0, { width: 1, height: stepHeadroom(i, stepAt(start, dir, i, rec.turns).y) }, stepAt(start, dir, i, rec.turns), MINE_NAME, undefined, { save: false }))) {
      if (isCommandCancelled()) return fail("aborted", "stopped");
      const why = tunnelStopReason();
      if (why === "no_tool") return fail("no_tool", "my pickaxe wore out digging the stairs");
      if (why === "no_filler") return fail("missing_items", "nothing to build the stairs' floor with over a cave");
      // Only a real blocker means the stairs go no deeper
      if (why === "blocked" || why === "drop") return fail("refused", why === "drop" ? "a drop I can't build a floor over" : "water or lava I couldn't plug, or something built");
      return fail("unreachable", "the stairs stopped (I'll try again)");
    }
    await saveMine(start, dir, i + 1, rec.branches, rec.bottom);
    // This step's floor, walls and roof whole before the next one (game
    // test: ten steps dug down through a cavern, the walls left for later,
    // and a creeper and a zombie came in)
    await mendNewStep(i);
  }
  // The new steps' walls and roof whole (game test: the second step ran
  // through a tunnel it had dug up to the grass, and the mine stayed open
  // to the surface)
  await lookAfterStairs();
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
  // Ore it sees is gathered, its walks cutting through the walls to it; the
  // sleeve's floor is mended after (owner)
  await whileGathering(async () => {
    for (const item of STRIP_ORES) {
      if (isCommandCancelled()) return;
      if (oreCapped(item)) continue; // plenty of it (owner: copper past 32)
      await collectBlock(item, 16, ORE_REACH, { seenOnly: true });
    }
  });
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
