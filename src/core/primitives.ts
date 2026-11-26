// Path: src/core/primitives.ts
// The checked game actions (Phase 3). Each one checks what it can before it
// starts (is that part of the world loaded, is it within reach, does the bot
// carry the item, does it have a tool), runs the game call with a time limit,
// the stop signal and the connection watched (core/guard), and then checks the
// world again: success means the server agreed. Actions in src/actions/ use
// these instead of calling bot.dig, bot.placeBlock, bot.equip... directly.

import type { Block } from "prismarine-block";
import type { Item } from "prismarine-item";
import type { Entity } from "prismarine-entity";
import type { Recipe } from "prismarine-recipe";
import type { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { bot } from "./body";
import { guarded } from "./guard";
import { paceClicks } from "./pace";
import { pathing, tools } from "./plugins";
import { avoidStep, isNatural, isProtected } from "./movements";
import { isAnyReflexActive } from "./reflexes";
import { placeKey, recentFailure } from "./failures";
import { forbiddenAt, noteRevert } from "./forbidden";
import { beginUse, takeoverCount, waitTurn, type Resource } from "./leases";
import { currentSignal } from "./commandContext";
import { isOwnBlock, placingOnPurpose } from "./scaffold";
import { markSelfAction } from "./events";
import { describeFailure, fail, ok, type ActionResult } from "./result";
import pf from "mineflayer-pathfinder";

type Goal = goals.Goal;
type Pos = { x: number; y: number; z: number };

/** How far the bot can touch a block (from its eyes to the block's middle). */
export const REACH = 4.5;
// Blocks that fall: a new one dropping into the gap isn't the server putting it back
const FALLING = new Set(["sand", "red_sand", "gravel", "suspicious_sand", "suspicious_gravel", "anvil", "chipped_anvil", "damaged_anvil", "pointed_dripstone", "scaffolding"]);
const DIG_SLACK_MS = 3_000; // on top of the dig's own time (bot.digTime), which already counts water and air
const PLACE_TIMEOUT_MS = 5_000;
const EQUIP_TIMEOUT_MS = 5_000;
const CONSUME_TIMEOUT_MS = 5_000;
const TOSS_TIMEOUT_MS = 3_000;
// mineflayer gives up waiting for a crafting table's window after 20 s; waiting
// longer than that lets its own timeout fire first, so no stale wait is left
// to grab the next window that opens (a chest)
const CRAFT_TIMEOUT_MS = 25_000;
// Recipe runs per craft call: one. Several runs in one open window stall
// after the first or second (mineflayer waits for a result slot that never
// updates): 47 cobblestone stairs took a 25 s timeout every 4 or 8 of them
// (game test). One run per call opens the window afresh each time, paced
const CRAFT_BATCH = 1;
const USE_TIMEOUT_MS = 5_000;
const CONFIRM_MS = 1_000; // how long the server gets to show the change
// A walk that gets nowhere for this long is stuck (owner: 8 s at most; a
// player notices in a few seconds). Digging or building a step counts as going
export const WALK_NO_PROGRESS_MS = 8_000;
// Digging or building its way along counts as progress, but not for ever in
// one spot: it placed the same scaffold block by a tree for over a minute
// (fresh-world test) and the 8 s limit never came: 8 s of it at most
const WORK_IN_PLACE_MS = 8_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const floor = (p: Pos): Vec3 => new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
const eyes = (): Vec3 => bot.entity.position.offset(0, bot.entity.height ?? 1.62, 0);
const middle = (p: Pos): Vec3 => new Vec3(p.x + 0.5, p.y + 0.5, p.z + 0.5);

/** Waits until `check` is true, up to `ms`. */
async function until(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(50);
  }
  return check();
}

// --- Reading the world: unknown is unknown -------------------------------------

/**
 * The block at a spot, or null when that part of the world isn't loaded.
 * Null means "unknown", never "air": callers must not walk, dig or build on it.
 */
export function knownBlock(pos: Pos): Block | null {
  return bot.blockAt(floor(pos)) ?? null;
}

/** True when the spot is loaded and empty (air, a plant, water or lava): something can be placed there. */
export function isReplaceable(block: Block | null): boolean {
  return block !== null && block.boundingBox === "empty";
}

/** True when the bot can touch the block at `pos` from where it stands. */
export function withinReach(pos: Pos, reach = REACH): boolean {
  return eyes().distanceTo(middle(floor(pos))) <= reach;
}

// --- Walking -----------------------------------------------------------------

/** The server's round trip, for how long to wait before trusting what the world shows. */
function settleMs(): number {
  const ping = (bot.player as { ping?: number } | undefined)?.ping ?? 100;
  return Math.max(100, 2 * ping + 50);
}

/** True when the bot stands at the goal, as the pathfinder itself judges it (a slab, farmland or a chest is fine). */
function atGoal(goal: Goal): boolean {
  const feet = bot.entity.position.floored();
  return goal.isEnd(feet as never) || goal.isEnd(feet.offset(0, 1, 0) as never);
}

/**
 * Watches a walk: gives up when the bot gets no closer for a while (not
 * counting time a reflex holds it: running from a creeper, a fight).
 */
function walkWatchdog(explain: () => string = () => ""): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  let last = bot.entity.position.clone();
  let lastProgress = Date.now();
  // Where and when it last really moved (digging or building in place isn't moving)
  let anchor = bot.entity.position.clone();
  let lastMoved = Date.now();
  let hopped = false;
  const timer = setInterval(() => {
    if (!bot.entity) return;
    const here = bot.entity.position;
    if (here.distanceTo(anchor) > 1.5) {
      anchor = here.clone();
      lastMoved = Date.now();
    }
    const working = Boolean(bot.pathfinder?.isMining?.() || bot.pathfinder?.isBuilding?.()) && Date.now() - lastMoved < WORK_IN_PLACE_MS;
    if (here.distanceTo(last) > 0.5 || isAnyReflexActive() || working) {
      last = here.clone();
      lastProgress = Date.now();
      if (isAnyReflexActive()) lastMoved = Date.now();
    } else if (Date.now() - lastProgress > WALK_NO_PROGRESS_MS) {
      // What it was doing, so a stall in a game test can be explained from the log
      const where = `${here.x.toFixed(2)}, ${here.y.toFixed(2)}, ${here.z.toFixed(2)}, ${bot.entity.onGround ? "on the ground" : "not on the ground"}`;
      if (!hopped) {
        // A player hops when stuck (wedged on a tree's leaves after chopping
        // its top, first game test): once, then a few more seconds to move
        hopped = true;
        console.log(`Walk stuck at ${where}: hopping. ${explain()}`);
        bot.setControlState("jump", true);
        setTimeout(() => bot.setControlState?.("jump", false), 400);
        lastProgress = Date.now() - WALK_NO_PROGRESS_MS / 2;
        return;
      }
      console.log(`Walk stalled at ${here.floored()} (${where}): ${explain()}`);
      controller.abort(`no progress for ${WALK_NO_PROGRESS_MS / 1000}s`);
    }
  }, 1_000);
  return { signal: controller.signal, stop: () => clearInterval(timer) };
}

/**
 * Walks to a goal and checks it really got there. Unreachable goals, a stop,
 * no progress for a while, a time limit or a dropped connection end it with
 * the matching reason. A goal changed by something else is "interrupted".
 */
// Where the last walk was headed (the stuck watcher remembers it when giving up)
let lastGoal: Pos | null = null;

/** The spot the last walk was headed for, if its goal has one. */
export function lastWalkGoal(): Pos | null {
  return lastGoal;
}

// Leaves and trunks: what it stands on when it spawned on top of a tree
const TREE_BLOCK = /_leaves$|_log$|_wood$|_stem$/;
// Blocks a right-click uses (the pathfinder's own list)
const INTERACTABLE: string[] = require("mineflayer-pathfinder/lib/interactable.json");

/** A real tree: leaves around it (a log cabin's roof has none), and nothing it or the owner built. */
function naturalTreeAround(at: Vec3): boolean {
  if (isProtected(at) || isOwnBlock(at)) return false;
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++)
      for (let dz = -2; dz <= 2; dz++) {
        if (bot.blockAt(at.offset(dx, dy, dz))?.name.endsWith("_leaves")) return true;
      }
  return false;
}

/**
 * The top of the trunk under or next to it: the nearest log column within 3
 * blocks sideways and 12 below its feet (null when it isn't up a tree).
 */
function trunkBelow(): Vec3 | null {
  if (!bot.entity || !bot.blockAt) return null;
  const feet = bot.entity.position.floored();
  let best: { at: Vec3; d: number } | null = null;
  for (let dx = -3; dx <= 3; dx++)
    for (let dz = -3; dz <= 3; dz++)
      for (let dy = 1; dy <= 12; dy++) {
        const at = feet.offset(dx, -dy, dz);
        if (!/_log$|_stem$/.test(bot.blockAt(at)?.name ?? "")) continue;
        const d = dx * dx + dz * dz;
        if (!best || d < best.d || (d === best.d && at.y > best.at.y)) best = { at, d };
        break; // the highest log of this column
      }
  return best?.at ?? null;
}

/**
 * Up a tree (it spawned on top of a spruce, fresh-world test): onto the top
 * of the trunk under it, then chops straight down it, a block at a time,
 * leaves and logs, until it stands on the ground; the logs come with it.
 * True if it got any lower.
 */
export async function climbDownTree(): Promise<boolean> {
  if (!onTree()) return false;
  // Only a real tree, never a wooden roof someone built
  const under = blockUnderMe();
  if (!under || !naturalTreeAround(under.position)) return false;
  const start = bot.entity.position.floored();
  const trunk = trunkBelow();
  console.log(`Up a tree at ${start}: ${trunk ? `chopping down the trunk at ${trunk.x}, ${trunk.z}` : "no trunk under me; digging straight down"}.`);
  // Onto the trunk's column: across the leaves at this height (breaking
  // leaves in the way is fine; they're natural)
  if (trunk && (start.x !== trunk.x || start.z !== trunk.z)) {
    const over = await walkTo(new pf.goals.GoalBlock(trunk.x, start.y, trunk.z));
    if (!over.ok) console.log(`Couldn't step over the trunk (${describeFailure(over)}); digging down from here.`);
  }
  let lower = false;
  for (let i = 0; i < 60 && bot.entity; i++) {
    if (currentSignal()?.aborted) break;
    const below = blockUnderMe();
    if (!below || !TREE_BLOCK.test(below.name)) break; // on the ground
    if (isProtected(below.position) || isOwnBlock(below.position)) break;
    const p = below.position;
    let drop = 0;
    while (drop < 5 && bot.blockAt(p.offset(0, -1 - drop, 0))?.boundingBox === "empty") drop++;
    if (drop > 3) {
      console.log(`Breaking the ${below.name} under me would drop me ${drop}+ blocks; stopping here.`);
      break;
    }
    const broken = await breakBlock(p, { allowWithoutHarvest: true });
    if (!broken.ok) {
      console.log(`Couldn't break the ${below.name} under me (${describeFailure(broken)}).`);
      break;
    }
    lower = true;
    await sleep(350 + drop * 150); // falling onto the next block
  }
  if (lower) console.log(`Climbed down the tree, to ${bot.entity?.position.floored()}.`);
  return lower;
}

/**
 * A step it keeps failing to enter though its map says it's open: likely a
 * "ghost" (the server put back a block it dug and the bot never heard; it
 * pushed against a step of its own stairs for minutes, fresh-world test).
 * Like a player, it right-clicks there with a pickaxe or sword in hand
 * (they do nothing to a block): the server answers every click by sending
 * the clicked block and the one next to it, so the map is right again and
 * the next path digs it.
 */
async function resyncStep(step: Vec3): Promise<void> {
  const tool = bot.inventory?.items().find((i) => /_pickaxe$|_sword$/.test(i.name));
  if (!tool || !bot.blockAt) return;
  const before = [step, step.offset(0, 1, 0)].map((c) => bot.blockAt(c)?.name ?? "?");
  // Only air or a plain block is clicked: never a door, chest, bed, gate or
  // anything else a right-click would use
  const usable = new Set<string>(INTERACTABLE);
  const harmless = (b: Block): boolean => b.name.endsWith("air") || (b.boundingBox === "block" && !usable.has(b.name) && !/_door$|_trapdoor$|_bed$|chest|barrel|furnace|_gate$/.test(b.name));
  try {
    if (bot.heldItem?.name !== tool.name) {
      const held = await equipItem(tool.name);
      if (!held.ok) return;
    }
    // Its floor's top (answers: floor and feet), then the feet cell's top (feet and head)
    for (const cell of [step.offset(0, -1, 0), step]) {
      const b = bot.blockAt(cell);
      if (b && harmless(b)) await bot.activateBlock(b, new Vec3(0, 1, 0));
    }
    await sleep(300); // the answers
  } catch (error) {
    console.log(`Couldn't check the step at ${step} with the server: ${(error as Error).message}`);
    return;
  }
  const after = [step, step.offset(0, 1, 0)].map((c) => bot.blockAt(c)?.name ?? "?");
  const changed = after.some((n, i) => n !== before[i]);
  console.log(`Checked the step at ${step} with the server: ${changed ? `it was really ${after.join(" / ")} (I had ${before.join(" / ")})` : `still ${after.join(" / ")}`}.`);
}

/**
 * Stuck climbing a step in a tunnel (a 3-high diagonal stair: it hung at the
 * riser twice, fresh-world tests): a player digs out the block over their
 * head and jumps again. Breaks the block above its head here and above the
 * next step's head, when they're natural and solid.
 */
async function headroomForStep(next: Vec3): Promise<void> {
  if (!bot.entity || !bot.blockAt) return;
  const feet = bot.entity.position.floored();
  if (next.y <= feet.y) return; // not a climb
  for (const cell of [feet.offset(0, 3, 0), next.offset(0, 2, 0)]) {
    const b = bot.blockAt(cell);
    if (!b || b.boundingBox !== "block" || !isNatural(b.name) || isProtected(cell)) continue;
    const broken = await breakBlock(cell);
    console.log(broken.ok ? `Dug out the ${b.name} over my head at ${cell} to get up the step.` : `Couldn't dig the ${b.name} over my head at ${cell}: ${describeFailure(broken)}.`);
  }
}

/** What the bot's keys and body were doing when a walk stalled (to explain it from the log). */
function controlsNow(next: { x: number; z: number } | null): string {
  const c = (bot.controlState ?? {}) as unknown as Record<string, boolean>;
  const held = (["forward", "back", "left", "right", "jump", "sprint", "sneak"] as const).filter((k) => c[k]);
  const deg = (r: number): number => Math.round((r * 180) / Math.PI);
  const p = bot.entity.position;
  const want = next ? `, path wants ${deg(Math.atan2(-(Math.floor(next.x) + 0.5 - p.x), -(Math.floor(next.z) + 0.5 - p.z)))}` : "";
  const effects = Object.keys(bot.entity.effects ?? {}).length;
  // Every block whose collision box touches its body (within 0.1): what physics bumps into
  const touching: string[] = [];
  const w = 0.3 + 0.1;
  for (let x = Math.floor(p.x - w); x <= Math.floor(p.x + w); x++)
    for (let y = Math.floor(p.y - 0.1); y <= Math.floor(p.y + 1.9); y++)
      for (let z = Math.floor(p.z - w); z <= Math.floor(p.z + w); z++) {
        const b = bot.blockAt(new Vec3(x, y, z), false);
        for (const sh of (b?.shapes ?? []) as number[][]) {
          const [x0, y0, z0, x1, y1, z1] = [x + sh[0]!, y + sh[1]!, z + sh[2]!, x + sh[3]!, y + sh[4]!, z + sh[5]!];
          if (x1 >= p.x - w && x0 <= p.x + w && z1 >= p.z - w && z0 <= p.z + w && y1 >= p.y - 0.1 && y0 <= p.y + 1.9) {
            touching.push(`${b!.name} ${x},${y},${z}`);
            break;
          }
        }
      }
  return `keys ${held.join("+") || "none"}, facing ${deg(bot.entity.yaw)}${want}${effects ? `, ${effects} effects` : ""}; touching ${touching.join("; ") || "nothing"}`;
}

/** The block it stands on: under its middle, or (on an edge) under a corner of its body. */
function blockUnderMe(): Block | null {
  if (!bot.entity || !bot.blockAt) return null;
  const { x, y, z } = bot.entity.position;
  for (const [dx, dz] of [[0, 0], [0.29, 0.29], [0.29, -0.29], [-0.29, 0.29], [-0.29, -0.29]] as const) {
    const b = bot.blockAt(new Vec3(x + dx!, y - 0.5, z + dz!).floored());
    if (b && b.boundingBox === "block") return b;
  }
  return null;
}

/** True when it stands on a tree's leaves or trunk. */
const onTree = (): boolean => TREE_BLOCK.test(blockUnderMe()?.name ?? "");

// A path search that ran out of time gets one more go with this much (down
// its mine, the way back to an ore "took too long to decide", fresh-world test)
const LONG_THINK_MS = 15_000;

export async function goTo(goal: Goal, options: { timeoutMs?: number; climbedDown?: boolean; thoughtLonger?: boolean } = {}): Promise<ActionResult> {
  let result = await walkTo(goal, options);
  if (!result.ok && result.reason === "unreachable" && !options.thoughtLonger && /too? long to decide/i.test(result.detail ?? "")) {
    const saved = pathing.thinkTimeout;
    pathing.thinkTimeout = Math.max(saved, LONG_THINK_MS);
    try {
      console.log("The way there took too long to work out; thinking longer.");
      result = await walkTo(goal, options);
    } finally {
      pathing.thinkTimeout = saved;
    }
  }
  // No way from up a tree: down the trunk, then once more
  if (!result.ok && result.reason === "unreachable" && !options.climbedDown && bot.entity && onTree() && (await climbDownTree())) {
    return goTo(goal, { ...options, climbedDown: true });
  }
  return result;
}

async function walkTo(goal: Goal, options: { timeoutMs?: number } = {}): Promise<ActionResult> {
  const g = goal as unknown as Partial<Pos>;
  const spot = typeof g.x === "number" && typeof g.y === "number" && typeof g.z === "number" ? { x: g.x, y: g.y, z: g.z } : null;
  if (spot) {
    // Got stuck going there a little while ago: don't walk into the same dead end
    const failed = recentFailure(placeKey(spot));
    if (failed) return fail("unreachable", `${failed} a little while ago`);
    lastGoal = spot;
  }
  // The pathfinder's last word on this walk (a path, no path, a timeout)
  let lastPath = "no path computed yet";
  let nextStep: { x: number; y: number; z: number } | null = null;
  const onPath = (r: { status: string; path: Array<{ x: number; y: number; z: number; toBreak?: unknown[]; toPlace?: unknown[] }> }): void => {
    // The next step too: where a stalled walk was trying to go first
    const next = r.path[0];
    nextStep = next ?? null;
    const how = next ? ` (next ${Math.floor(next.x)}, ${Math.floor(next.y)}, ${Math.floor(next.z)}${next.toBreak?.length ? `, breaking ${next.toBreak.length}` : ""}${next.toPlace?.length ? `, placing ${next.toPlace.length}` : ""})` : "";
    lastPath = `${r.status}, ${r.path.length} moves${how}`;
  };
  bot.on?.("path_update" as never, onPath as never);
  // Times the server put it back where it was (it refused a move): a stall
  // against an open step may be the server saying no
  let movedBack = 0;
  const onForced = (): void => {
    movedBack++;
  };
  bot.on?.("forcedMove" as never, onForced as never);
  // The first few server teleports of a walk, raw, with where the bot was
  // just before (it keeps getting put back at a step it's pushing into)
  let shown = 0;
  const client = (bot as unknown as { _client?: { prependListener?: (e: string, f: (p: unknown) => void) => void; removeListener?: (e: string, f: (p: unknown) => void) => void } })._client;
  const onTeleport = (packet: unknown): void => {
    if (shown++ >= 3 || !bot.entity) return;
    const p = bot.entity.position;
    const v = bot.entity.velocity;
    console.log(`Server teleport ${shown}: ${JSON.stringify(packet)}; I was at ${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)} moving ${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}, ${bot.entity.onGround ? "on the ground" : "in the air"}.`);
  };
  client?.prependListener?.("position", onTeleport);
  const block = (dy: number): string => bot.blockAt(bot.entity.position.floored().offset(0, dy, 0))?.name ?? "?";
  const watchdog = walkWatchdog(
    () =>
      `goal ${spot ? `${spot.x}, ${spot.y}, ${spot.z}` : goal.constructor.name}; path ${lastPath}; ` +
      `moving ${bot.pathfinder?.isMoving() ?? "?"}, mining ${bot.pathfinder?.isMining() ?? "?"}, building ${bot.pathfinder?.isBuilding() ?? "?"}; ` +
      `below ${block(-1)}, feet ${block(0)}, head ${block(1)}, over head ${block(2)}` +
      // And around the step it's trying to reach: why it can't get onto it
      (nextStep
        ? (() => {
            const n = nextStep as { x: number; y: number; z: number };
            const at = (dy: number): string => bot.blockAt(new Vec3(Math.floor(n.x), Math.floor(n.y) + dy, Math.floor(n.z)))?.name ?? "?";
            return `; next step: floor ${at(-1)}, feet ${at(0)}, head ${at(1)}, over head ${at(2)}`;
          })()
        : "") +
      `; ${controlsNow(nextStep)}, server moved me back ${movedBack} times`
  );
  try {
    const walked = await guarded("walking", (signal) => pathing.goto(goal, signal), {
      timeoutMs: options.timeoutMs ?? 10 * 60_000, // the watchdog ends stuck walks long before this
      watchdog: watchdog.signal,
      onStop: () => pathing.stopIf(goal), // never clear a reflex's goal or a paused follow
    });
    if (!walked.ok) {
      // Stuck on a step: the next walk routes around it, and the bot asks the
      // server what's really there (it may be a block it thinks it dug)
      // (set by the path listener; TypeScript can't see that)
      const stuckOn = nextStep as { x: number; y: number; z: number } | null;
      if (walked.reason === "timeout" && stuckOn) {
        const next = new Vec3(Math.floor(stuckOn.x), Math.floor(stuckOn.y), Math.floor(stuckOn.z));
        await resyncStep(next);
        await headroomForStep(next);
        avoidStep(stuckOn);
      }
      return walked;
    }
  } finally {
    watchdog.stop();
    bot.removeListener?.("path_update" as never, onPath as never);
    bot.removeListener?.("forcedMove" as never, onForced as never);
    client?.removeListener?.("position", onTeleport);
    // Only a walk in progress can be blamed for being stuck (not one that ended, at a chest or a table)
    if (spot && lastGoal === spot) lastGoal = null;
  }
  if (!bot.entity) return fail("disconnected", "no body after walking");
  if (!atGoal(goal)) return fail("unreachable", "stopped short of the goal");
  return ok();
}

// --- Breaking blocks ------------------------------------------------------------

export type BreakOptions = {
  /** Break it even if the drop is lost (leaves, or clearing the way). Default: a tool that harvests it is required. */
  allowWithoutHarvest?: boolean;
};

/**
 * Breaks the block at `pos` with the best tool it carries, and checks it is
 * really gone. The bot must already be within reach. Air, water and lava are
 * "nothing to break" (ok, with `alreadyGone`).
 */
async function breakBlockNow(pos: Pos, options: BreakOptions = {}): Promise<ActionResult<{ name: string; alreadyGone: boolean }>> {
  const at = floor(pos);
  const block = knownBlock(at);
  if (!block) return fail("unknown_block", `${at} isn't loaded`);
  if (block.name === "air" || block.name === "cave_air" || block.name === "water" || block.name === "lava") {
    return ok({ name: block.name, alreadyGone: true });
  }
  const keepOut = forbiddenAt(at);
  if (keepOut) return fail("forbidden", keepOut.reason);
  if (!withinReach(at)) return fail("out_of_reach", `${block.name} at ${at}`);
  if (bot.game.gameMode !== "creative") {
    const tool = await guarded("taking a tool", () => tools.equipForBlock(block), { timeoutMs: CONFIRM_MS * 5 });
    if (!tool.ok && tool.reason !== "error") return tool;
    const held = bot.heldItem ? bot.heldItem.type : null;
    if (!options.allowWithoutHarvest && !block.canHarvest(held)) return fail("no_tool", `nothing I carry harvests ${block.name}`);
  }
  if (!bot.canDigBlock(block)) return fail("refused", `${block.name} can't be broken`);
  const before = block.stateId;
  markSelfAction(at);
  const dug = await guarded(`digging ${block.name}`, () => bot.dig(block, true), {
    timeoutMs: bot.digTime(block) * 1.5 + DIG_SLACK_MS,
    onStop: () => bot.stopDigging(),
  });
  if (!dug.ok) return dug;
  // mineflayer writes air into its own world copy the moment the dig ends;
  // the server's answer comes a round trip later, and a protected area puts
  // the block back then. Only the state after that counts.
  await sleep(settleMs());
  if (knownBlock(at)?.stateId === before) {
    // Sand or gravel from above falls into the gap: that's not the server
    if (FALLING.has(block.name) || block.name.endsWith("_concrete_powder")) return ok({ name: block.name, alreadyGone: false });
    await noteRevert(at); // twice close together: a protected area
    return fail("reverted", `${block.name} at ${at} came back`);
  }
  return ok({ name: block.name, alreadyGone: false });
}

// --- Placing blocks -------------------------------------------------------------

const FACES = [new Vec3(0, -1, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0)];

/** A solid block next to `at` to place against, bottom first (or the side asked for). */
function supportFor(at: Vec3, prefer?: Vec3): { reference: Block; face: Vec3 } | null {
  const order = prefer ? [prefer, ...FACES.filter((f) => !f.equals(prefer))] : FACES;
  for (const d of order) {
    const reference = knownBlock(at.plus(d));
    if (reference && reference.boundingBox === "block") return { reference, face: d.scaled(-1) };
  }
  return null;
}

/**
 * True when a body at `pos` (0.6 wide, 1.8 tall) reaches into any of these
 * cells. Pure. Game test: standing at the edge of its shelter's doorway, its
 * feet cell beside it, the server refused the door again and again ("still air"),
 * most likely because its own body was in the door's space.
 */
export function bodyReaches(pos: Pos, cells: Pos[], halfWidth = 0.3, height = 1.8): boolean {
  return cells.some(
    (c) =>
      pos.x + halfWidth > c.x && pos.x - halfWidth < c.x + 1 &&
      pos.z + halfWidth > c.z && pos.z - halfWidth < c.z + 1 &&
      pos.y + height > c.y && pos.y < c.y + 1
  );
}

/** The cells a placed block takes up: a door is two tall. */
const cellsTaken = (itemName: string, at: Vec3): Vec3[] => (itemName.endsWith("_door") ? [at, at.offset(0, 1, 0)] : [at]);

/** True when the bot's own body is in the space the block would take (a full block or a door can't go there). */
function standingIn(at: Vec3, itemName = ""): boolean {
  return bodyReaches(bot.entity.position, cellsTaken(itemName, at));
}

export type PlaceOptions = {
  /** Place against the block on this side of the spot (e.g. (0,-1,0): on the floor). */
  against?: Vec3;
};

/**
 * Places the exact item `itemName` at `pos` and checks the block is there.
 * The spot must be free, the bot within reach, and something solid next to
 * it. A server that refuses (a protected area) gives "refused".
 */
async function placeBlockAtNow(itemName: string, pos: Pos, options: PlaceOptions = {}): Promise<ActionResult<{ name: string }>> {
  const at = floor(pos);
  const item = bot.inventory.items().find((i) => i.name === itemName);
  if (!item) return fail("missing_items", `no ${itemName} to place`);
  const target = knownBlock(at);
  if (!target) return fail("unknown_block", `${at} isn't loaded`);
  const keepOut = forbiddenAt(at);
  if (keepOut) return fail("forbidden", keepOut.reason);
  if (!isReplaceable(target)) return fail("occupied", `${target.name} at ${at}`);
  const support = supportFor(at, options.against);
  if (!support) return fail("no_support", `nothing solid next to ${at}`);
  if (!withinReach(support.reference.position)) return fail("out_of_reach", `${at}`);
  // A solid block can't go where the bot stands; torches, rails, seeds and the
  // like can (an item that isn't a block by the same name is never solid here)
  if (standingIn(at, itemName) && bot.registry.blocksByName[itemName]?.boundingBox === "block") return fail("occupied", "I'm standing there");
  const equipped = await equipItem(itemName, "hand");
  if (!equipped.ok) return equipped;
  await guarded("looking", () => bot.lookAt(middle(support.reference.position), true), { timeoutMs: 2_000 });
  const before = target.stateId;
  markSelfAction(at);
  const placed = await guarded(`placing ${itemName}`, () => placingOnPurpose(() => bot.placeBlock(support.reference, support.face)), {
    timeoutMs: PLACE_TIMEOUT_MS,
  });
  // mineflayer throws when the server's answer doesn't show the block; check the world either way
  // Torches, rails and flowers have no collision box, so "a different block,
  // not air" is the test (water rising or falling there doesn't count)
  const changed = (): boolean => {
    const b = knownBlock(at);
    return b !== null && b.stateId !== before && b.name !== target.name && b.name !== "air" && b.name !== "cave_air";
  };
  await until(changed, placed.ok ? CONFIRM_MS : 300);
  if (changed()) await sleep(settleMs()); // the server may still take it back
  const now = changed();
  if (now) return ok({ name: knownBlock(at)!.name });
  if (!placed.ok && placed.reason !== "error" && placed.reason !== "refused") return placed;
  // Only the server undoing it counts toward a protected area (not a mob standing in the spot)
  // A living thing in the spot (a dropped item or an orb never blocks a
  // block: counting them hid why a bed didn't go down, fresh-world test)
  const taken = cellsTaken(itemName, at);
  const blocker = Object.values(bot.entities).find(
    (e) => e !== bot.entity && e.name !== "item" && e.name !== "experience_orb" && e.name !== "arrow" && bodyReaches(e.position, taken, (e.width ?? 0.6) / 2, e.height ?? 1.8)
  );
  if (!blocker) await noteRevert(at); // twice close together: a protected area
  const why = placed.ok ? "" : ` (${describeFailure(placed)})`;
  return fail(blocker ? "occupied" : "reverted", blocker ? `${blocker.username ?? `a ${(blocker.name ?? "mob").replace(/_/g, " ")}`} is standing at ${at}` : `${itemName} at ${at} didn't stay${why}`);
}

// --- Hands and inventory ---------------------------------------------------------

export type EquipSlot = "hand" | "off-hand" | "head" | "torso" | "legs" | "feet";

/** The item in an equipment slot right now. */
function equippedIn(slot: EquipSlot): Item | null {
  if (slot === "hand") return bot.heldItem ?? null;
  return bot.inventory.slots[bot.getEquipmentDestSlot(slot)] ?? null;
}

/** Puts the exact item `itemName` in a hand or armor slot and checks it's there. */
async function equipItemNow(itemName: string, slot: EquipSlot = "hand"): Promise<ActionResult> {
  if (equippedIn(slot)?.name === itemName) return ok();
  const item = bot.inventory.items().find((i) => i.name === itemName);
  if (!item) return fail("missing_items", `no ${itemName}`);
  const done = await guarded(`equipping ${itemName}`, () => bot.equip(item, slot), { timeoutMs: EQUIP_TIMEOUT_MS });
  if (!done.ok) return done;
  if (!(await until(() => equippedIn(slot)?.name === itemName, CONFIRM_MS))) return fail("refused", `${itemName} isn't in my ${slot}`);
  return ok();
}

/** Takes off what's in an equipment slot. */
async function unequipSlotNow(slot: EquipSlot): Promise<ActionResult> {
  if (!equippedIn(slot)) return ok();
  if (bot.inventory.emptySlotCount() === 0) return fail("full", "no room to take it off");
  const done = await guarded(`taking off ${slot}`, () => bot.unequip(slot), { timeoutMs: EQUIP_TIMEOUT_MS });
  if (!done.ok) return done;
  if (!(await until(() => !equippedIn(slot), CONFIRM_MS))) return fail("refused", `${slot} is still on`);
  return ok();
}

/** How many of an exact item the bot carries. */
export function carried(itemName: string): number {
  return bot.inventory.items().filter((i) => i.name === itemName).reduce((n, i) => n + i.count, 0);
}

/** Eats or drinks the exact item `itemName` and checks one is gone. */
async function consumeItemNow(itemName: string): Promise<ActionResult> {
  const before = carried(itemName);
  if (before === 0) return fail("missing_items", `no ${itemName}`);
  const equipped = await equipItem(itemName, "hand");
  if (!equipped.ok) return equipped;
  const done = await guarded(`eating ${itemName}`, () => bot.consume(), {
    timeoutMs: CONSUME_TIMEOUT_MS,
    onStop: () => bot.deactivateItem(),
  });
  if (!done.ok) return done;
  if (!(await until(() => carried(itemName) < before, CONFIRM_MS))) return fail("refused", `still have the ${itemName}`);
  return ok();
}

/** Throws `count` of the exact item stack `item` on the ground in front, and checks they left. */
async function tossStackNow(item: Item, count: number): Promise<ActionResult<number>> {
  const before = carried(item.name);
  const n = Math.min(count, item.count);
  const done = await guarded(`throwing ${item.name}`, () => bot.toss(item.type, null, n), { timeoutMs: TOSS_TIMEOUT_MS });
  if (!done.ok) return done;
  // A toss is window clicks mineflayer applies to its own copy right away;
  // ask the server for the real inventory before counting
  await syncInventory();
  if (!(await until(() => carried(item.name) <= before - n, CONFIRM_MS))) return fail("refused", `the ${item.name} came back`);
  return ok(n);
}

/**
 * Asks the server for the true contents of a window (the inventory by
 * default). On 1.17.1+ mineflayer applies clicks to its own copy and the
 * server stays silent about clicks it ignored; this makes it answer.
 */
export async function syncInventory(window: unknown = bot.inventory): Promise<void> {
  const sync = (bot as unknown as { _syncWindow?: (w: unknown) => Promise<void> })._syncWindow;
  if (!sync) return;
  await guarded("checking the inventory", () => sync(window), { timeoutMs: 2_000 });
}

/** Lets go of the item being used (lowers a shield, stops eating, after placing a boat). */
export function stopUsingItem(): void {
  bot.deactivateItem();
}

/** Creative mode only: puts an item straight into a hotbar slot. */
export async function giveCreativeItem(slot: number, item: Item): Promise<ActionResult> {
  return guarded("taking it from the creative menu", () => bot.creative.setInventorySlot(slot, item), { timeoutMs: USE_TIMEOUT_MS });
}

// --- Using blocks and looking -------------------------------------------------------

/** Looks at a point (turns the head). */
export async function lookAt(point: Pos): Promise<ActionResult> {
  return guarded("looking", () => bot.lookAt(new Vec3(point.x, point.y, point.z), true), { timeoutMs: 2_000 });
}

/** Right-clicks a block within reach (a lever, a door, a bed, a farmland with seeds in hand). */
async function useBlockNow(block: Block): Promise<ActionResult> {
  if (!withinReach(block.position)) return fail("out_of_reach", `${block.name} at ${block.position}`);
  return guarded(`using ${block.name}`, () => bot.activateBlock(block), { timeoutMs: USE_TIMEOUT_MS });
}

// --- Crafting --------------------------------------------------------------------

/**
 * Runs `recipe` `times` times (at `table`, or in the inventory grid) and
 * checks the result appeared. mineflayer waits for the crafting window with
 * no time limit; this gives up and closes the window instead.
 */
async function craftWithNow(recipe: Recipe, times: number, table: Block | null): Promise<ActionResult<number>> {
  const resultId = recipe.result.id;
  const resultName = bot.registry.items[resultId]?.name ?? String(resultId);
  if (table && !withinReach(table.position)) return fail("out_of_reach", `crafting table at ${table.position}`);
  // Leftovers in the inventory's own grid or on the cursor make the recipe
  // come out as something else (or nothing): put back first, every time. The
  // client can think the grid is empty while the server still has the last
  // craft's leftovers in it: the grid crafts that failed ("no stick
  // appeared") were exactly the ones not resynced first (game test)
  if (!table) await settleInventory(inventoryGridBusy() ? "leftovers in my crafting grid" : null);
  const before = carried(resultName);
  // In batches: each recipe run is several window clicks, and servers kick
  // players who click too fast
  for (let left = times; left > 0; left -= CRAFT_BATCH) {
    const batch = Math.min(CRAFT_BATCH, left);
    await paceClicks();
    const done = await guarded(`crafting ${resultName}`, () => bot.craft(recipe, batch, table ?? undefined), {
      timeoutMs: CRAFT_TIMEOUT_MS,
      onStop: () => {
        if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
      },
    });
    if (!done.ok) {
      // A craft that broke off leaves its ingredients in the grid or on the
      // cursor, where they don't count as carried: back into the inventory
      if (done.reason !== "disconnected") await settleInventory(`crafting ${resultName} broke off`);
      const made = carried(resultName) - before;
      return made > 0 && !(done.reason === "aborted" || done.reason === "disconnected") ? ok(made) : done;
    }
  }
  // mineflayer resyncs the window after crafting, so the inventory is the server's
  const expected = (recipe.result.count ?? 1) * times;
  if (!(await until(() => carried(resultName) >= before + expected, CONFIRM_MS))) {
    const made = carried(resultName) - before;
    if (made <= 0) return fail("refused", `no ${resultName} appeared`);
    return ok(made); // made fewer than asked (e.g. a stack was full): say how many
  }
  return ok(carried(resultName) - before);
}

/** True when the inventory's own 2x2 grid (slots 1-4) or the cursor holds something. */
function inventoryGridBusy(): boolean {
  const slots = bot.inventory?.slots ?? [];
  return [1, 2, 3, 4].some((i) => slots[i]) || Boolean(bot.inventory?.selectedItem);
}

/**
 * Puts what a broken-off craft left in the inventory's grid or on the cursor
 * back into the inventory, and takes the server's view of it. Closing the
 * inventory makes the server return those items; then the whole window is
 * asked for again. Game test: a plank craft timed out in the grid, the next
 * crafts said "missing ingredient" and 4 sticks it had just made were gone
 * from what it counted, three times in one session.
 */
async function settleInventory(why: string | null): Promise<void> {
  if (why) console.log(`Inventory: ${why}; putting the grid back and resyncing.`);
  try {
    bot._client.write("close_window", { windowId: 0 });
  } catch (error) {
    console.error("Inventory: couldn't close the grid:", error);
  }
  const sync = (bot as unknown as { _syncWindow?: (w: unknown) => Promise<void> })._syncWindow;
  if (sync) await guarded("resyncing my inventory", () => sync(bot.inventory), { timeoutMs: 3_000 });
}

// --- Beds ------------------------------------------------------------------------

/**
 * Lies down in a bed within reach and checks it's really asleep. The server's
 * reason when it can't (not night, monsters nearby, occupied) is the detail.
 */
export async function sleepIn(bed: Block): Promise<ActionResult> {
  if (!withinReach(bed.position)) return fail("out_of_reach", `bed at ${bed.position}`);
  const done = await guarded("going to bed", () => bot.sleep(bed), { timeoutMs: USE_TIMEOUT_MS });
  // "it's not night", "monsters nearby", "occupied": the server's answer is the detail
  if (!done.ok) return done.reason === "error" ? fail("refused", done.detail) : done;
  if (!(await until(() => bot.isSleeping, CONFIRM_MS))) return fail("refused", "not asleep");
  return ok();
}

// --- Riding and using things ---------------------------------------------------------

/** Gets on a boat, minecart or animal and checks it's riding. */
export async function mountEntity(entity: Entity): Promise<ActionResult> {
  if (bot.vehicle === entity) return ok();
  if (entity.position.distanceTo(bot.entity.position) > REACH + 1) return fail("out_of_reach", `${entity.name ?? "vehicle"} is too far`);
  const done = await guarded(`getting on the ${entity.name ?? "vehicle"}`, async () => bot.mount(entity), { timeoutMs: USE_TIMEOUT_MS });
  if (!done.ok) return done;
  if (!(await until(() => Boolean(bot.vehicle), 2_000))) return fail("refused", `couldn't get on the ${entity.name ?? "vehicle"}`);
  return ok();
}

/** Gets off whatever it rides and checks it's off. */
export async function dismountVehicle(): Promise<ActionResult> {
  if (!bot.vehicle) return ok();
  const done = await guarded("getting off", async () => bot.dismount(), { timeoutMs: USE_TIMEOUT_MS });
  if (!done.ok) return done;
  if (!(await until(() => !bot.vehicle, 3_000))) return fail("refused", "still riding");
  return ok();
}

/** Right-clicks with the held item (place a boat, a minecart; raise a shield with `offHand`). */
/**
 * Uses the held item (a bucket, an eye of ender) toward a point, once the
 * head has really turned there: a forced look only sends the turn on the
 * next physics tick, and the server aims the bucket with the old look
 * (architect review: fills and pours mostly did nothing).
 */
export async function useHeldItemToward(point: Pos): Promise<ActionResult> {
  const looked = await guarded("looking", () => bot.lookAt(new Vec3(point.x, point.y, point.z), false), { timeoutMs: 2_000 });
  if (!looked.ok) return looked;
  await bot.waitForTicks(1); // the turn is on its way to the server
  bot.activateItem();
  return ok();
}

export function useHeldItem(offHand = false): void {
  bot.activateItem(offHand);
}

/** Right-clicks an entity (saddle a horse, push a boat). */
export async function useEntity(entity: Entity): Promise<ActionResult> {
  if (entity.position.distanceTo(bot.entity.position) > REACH + 1) return fail("out_of_reach", `${entity.name ?? "entity"} is too far`);
  return guarded(`using the ${entity.name ?? "entity"}`, () => bot.activateEntity(entity), { timeoutMs: USE_TIMEOUT_MS });
}

/** Hits an entity once (breaking a boat to pick it up). */
export function hitEntity(entity: Entity): void {
  bot.attack(entity);
}

/**
 * Hits an entity by its id, for the parts of a many-part mob mineflayer
 * doesn't know as entities: the ender dragon is hit through its parts (its
 * head is the dragon's id + 1), never its own id (Phase 9).
 */
export function hitEntityId(id: number): void {
  // mineflayer's attack only reads the target's id, and picks the packet for
  // the server's version (use_entity on 1.20, its own attack packet on 26.x)
  bot.attack({ id } as Entity);
}

/**
 * Skips the credits after the End's exit portal: the server waits for the
 * client to say it's done before sending it home. mineflayer's own answer
 * names the field "action", which 1.20.3+ calls "actionId", so it hangs on
 * the credits; this answers with both.
 */
export function registerCreditsSkip(): void {
  const client = (bot as unknown as { _client: { on: (e: string, f: (p: { reason?: number; gameMode?: number }) => void) => void; write: (n: string, d: unknown) => void } })._client;
  client.on("game_state_change", (packet) => {
    if (packet.reason !== 4) return; // 4: "win game" (the credits)
    console.log("Skipping the credits.");
    client.write("client_command", { action: 0, actionId: 0 });
  });
}

/** Holds or lets go of a movement key (sneak, jump, forward...). */
export function setControl(control: "forward" | "back" | "left" | "right" | "jump" | "sprint" | "sneak", on: boolean): void {
  bot.setControlState(control, on);
}

/** Turns to a direction (yaw, pitch in radians). */
export async function lookToward(yaw: number, pitch: number): Promise<ActionResult> {
  return guarded("turning", () => bot.look(yaw, pitch, true), { timeoutMs: 2_000 });
}

// --- Taking turns with reflexes (core/leases) --------------------------------------

/**
 * Runs a hands/window action when it's this code's turn: waits while a reflex
 * (or a borrower, eating) has the resource, marks it in use so borrowers wait
 * for it to finish, and if a reflex cut in mid-way (a creeper: the dig was
 * stopped), waits for it to let go and tries again (up to 3 times).
 */
async function using<T>(resources: Resource[], act: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const signal = currentSignal();
  let result: ActionResult<T> = fail("interrupted", "never ran");
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const r of resources) {
      if (!(await waitTurn(r, () => Boolean(signal?.aborted)))) return fail("aborted", "stopped while waiting for my turn");
    }
    const before = resources.map((r) => takeoverCount(r));
    const ends = resources.map((r) => beginUse(r));
    try {
      result = await act();
    } finally {
      for (const end of ends) end();
    }
    const cutIn = resources.some((r, i) => takeoverCount(r) !== before[i]);
    if (result.ok || !cutIn || signal?.aborted) return result;
    console.log(`A reflex cut in (${result.reason}); trying again once it's done.`);
  }
  return result;
}

/** breakBlock, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function breakBlock(pos: Pos, options: BreakOptions = {}): Promise<ActionResult<{ name: string; alreadyGone: boolean }>> {
  return using(["hands"], () => breakBlockNow(pos, options));
}

/** placeBlockAt, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function placeBlockAt(itemName: string, pos: Pos, options: PlaceOptions = {}): Promise<ActionResult<{ name: string }>> {
  return using(["hands"], () => placeBlockAtNow(itemName, pos, options));
}

/** equipItem, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function equipItem(itemName: string, slot: EquipSlot = "hand"): Promise<ActionResult> {
  return using(["hands"], () => equipItemNow(itemName, slot));
}

/** unequipSlot, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function unequipSlot(slot: EquipSlot): Promise<ActionResult> {
  return using(["hands"], () => unequipSlotNow(slot));
}

/** consumeItem, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function consumeItem(itemName: string): Promise<ActionResult> {
  return using(["hands"], () => consumeItemNow(itemName));
}

/** tossStack, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function tossStack(item: Item, count: number): Promise<ActionResult<number>> {
  return using(["hands"], () => tossStackNow(item, count));
}

/** useBlock, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function useBlock(block: Block): Promise<ActionResult> {
  return using(["hands"], () => useBlockNow(block));
}

/** craftWith, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function craftWith(recipe: Recipe, times: number, table: Block | null): Promise<ActionResult<number>> {
  return using(["hands", "window"], () => craftWithNow(recipe, times, table));
}
