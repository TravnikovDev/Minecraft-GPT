import { bot } from "../core/body";
import { Vec3 } from "vec3";
import { catalog } from "../core/catalog";
import { breakBlockAt } from "./blockBreaking";
import { pickupNearbyItems } from "./pickup";
import { climbDownTree } from "../core/primitives";
import { goToPosition, moveAway } from "../actions/movement";
import { isCommandCancelled, reportProgress } from "../core/commandContext";
import { forbiddenAt } from "../core/forbidden";
import { recordSighting } from "./perception";
import { findTrunk, firstDayUnderway, isNaturalTree, rememberFelledTree, stumpsOf, treesToReplant } from "./forestry";
import { takeDownScaffolding } from "./scaffolding";
import pf from "mineflayer-pathfinder";
import type { Block } from "prismarine-block";
import { goTo } from "../core/primitives";
import { pathing } from "../core/plugins";

// Give up after this many failed attempts in a row to find or reach a tree
const MAX_FAILED_ATTEMPTS = 5;

/**
 * Gather wood blocks nearby to collect logs.
 * @param num The number of wood logs to gather.
 * @param maxDistance The maximum distance to search for wood blocks.
 * @returns Whether the wood gathering was successful.
 */
export async function gatherWood(
  num: number,
  maxDistance = 64
): Promise<boolean> {
  console.log(`Gathering wood... I need to collect ${num} logs.`);
  bot.chat(`Gathering wood... I need to collect ${num} logs.`);
  // Up a tree (spawned on top of one): chop down the trunk under it first,
  // top to bottom, like a player would (owner)
  const startingLogs = getLogsCount(); // the trunk's logs count toward `num`
  await climbDownTree();

  try {
    let logsCount = getLogsCount();
    const targetLogs = startingLogs + num; // Collect `num` new logs
    let failedAttempts = 0;
    // Logs it couldn't walk to (up a jungle trunk, behind leaves); without
    // this the nearest-log search returns the same one until it gives up
    const unreachable = new Set<string>();
    console.log(`I currently have ${logsCount} logs.`);

    while (logsCount < targetLogs) {
      if (isCommandCancelled()) {
        console.log("Wood gathering cancelled.");
        return false;
      }
      if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        const collected = logsCount - startingLogs;
        console.log(`Giving up on wood after ${failedAttempts} failed attempts.`);
        // Say what really happened: trees it couldn't get to are not "no trees"
        bot.chat(
          collected > 0
            ? `I could only get ${collected} of ${num} logs around here.`
            : unreachable.size > 0
              ? `I couldn't get to the trees around here.`
              : `I couldn't find any trees nearby.`
        );
        return false;
      }

      console.log(`Looking for wood blocks nearby... (${logsCount}/${targetLogs})`);

      const woodBlock = bot.findBlock({
        matching: (block) => catalog().isTreeLog(block.name), // nether stems too, never stripped logs in builds
        // Not one it couldn't reach, nor one in an area it must keep out of
        useExtraInfo: (block) => !unreachable.has(block.position.toString()) && !forbiddenAt(block.position),
        maxDistance,
      });

      if (woodBlock) recordSighting(woodBlock.name, woodBlock.position);
      if (!woodBlock) {
        console.log("No wood blocks found nearby.");
        failedAttempts++;
        await moveAway(50);
        continue;
      }

      // Giant 2x2 trees and tall jungle trees are never cut, like part of the
      // landscape (owner): checked before walking there. With no other tree
      // within reach it goes looking further (moveAway above)
      const seen = findTrunk(woodBlock, (p: Vec3) => bot.blockAt(p));
      if (leftStanding(seen)) {
        for (const log of seen) unreachable.add(log.position.toString());
        continue;
      }

      const destinationReached = await goToPosition(
        woodBlock.position.x,
        woodBlock.position.y,
        woodBlock.position.z,
        2
      );

      if (!destinationReached) {
        // The whole tree, not just this log: from where it got stuck the
        // other logs of that tree were unreachable too, and four of them used
        // up every try ("no trees nearby" with a forest around)
        const trunk = findTrunk(woodBlock, (p: Vec3) => bot.blockAt(p));
        for (const log of trunk) unreachable.add(log.position.toString());
        console.log(`Unable to reach the ${woodBlock.name} tree at ${woodBlock.position}; trying another tree.`);
        failedAttempts++;
        continue;
      }

      // The whole trunk, bottom up: a floating top keeps its leaves forever,
      // so no saplings would fall and the tree couldn't be replanted
      const at = (p: Vec3) => bot.blockAt(p);
      const aTree = findTrunk(woodBlock, at);
      if (!isNaturalTree(aTree, at)) {
        console.log(`The ${woodBlock.name} at ${woodBlock.position} has no leaves: something built, leaving it.`);
        for (const log of aTree) unreachable.add(log.position.toString());
        continue;
      }
      const stumps = stumpsOf(aTree, at);

      try {
        if (!(await fellTree(aTree))) return false;
        // Off the pillar it built to reach the top, and its scaffolding gone,
        // before moving on (otherwise it bridges from tree to tree)
        await takeDownScaffolding();
        rememberFelledTree(stumps, woodBlock.name); // back for the saplings once the leaves fall
        await pickupNearbyItems(bot);
        const newCount = getLogsCount();
        failedAttempts = newCount > logsCount ? 0 : failedAttempts + 1;
        logsCount = newCount;
        reportProgress(logsCount - startingLogs); // cut off now, it gathers only what's left
        console.log(`Collected logs. Total logs now: ${logsCount}.`);
      } catch (digError) {
        console.error("Failed to break the wood block:", digError);
        failedAttempts++;
        continue; // Attempt to find and break another wood block
      }
    }

    console.log(`Wood gathering complete! Total logs collected: ${logsCount}.`);
    if (treesToReplant() > 0 && !firstDayUnderway()) bot.chat("Once the leaves fall I'll pick up the saplings and replant the trees.");
    return true;
  } catch (error) {
    console.error("Failed to gather wood:", error);
    return false;
  }
}

/**
 * The top of a tree's crown over its trunk: the highest leaf in the column
 * right over the top log (the top log's own height when there's none). Pure
 * over `blockAt`.
 */
export function crownTop(top: { x: number; y: number; z: number }, blockAt: (p: Vec3) => { name: string } | null): number {
  let y = top.y;
  while (y < top.y + 6 && (blockAt(new Vec3(top.x, y + 1, top.z))?.name.endsWith("_leaves") ?? false)) y++;
  return y;
}

/**
 * Where its pillar goes (owner: beside the crown, not against the trunk):
 * a spot on the ground 2 to 4 blocks out from the trunk with nothing but air
 * from its feet up over `standY`, nearest the trunk first. Pure over `blockAt`.
 */
export function pillarSpot(top: { x: number; y: number; z: number }, standY: number, blockAt: (p: Vec3) => { boundingBox: string; name: string } | null): Vec3 | null {
  for (const r of [2, 3, 4]) {
    for (let dx = -r; dx <= r; dx++) {
      for (const dz of Math.abs(dx) === r ? Array.from({ length: 2 * r + 1 }, (_, k) => k - r) : [-r, r]) {
        const x = top.x + dx;
        const z = top.z + dz;
        // The ground under this column: the first solid block going down
        let feet: number | null = null;
        for (let y = top.y; y >= top.y - 16; y--) {
          const below = blockAt(new Vec3(x, y - 1, z));
          if (below && below.boundingBox === "block" && !below.name.endsWith("_leaves")) {
            feet = y;
            break;
          }
        }
        if (feet === null || feet > standY) continue;
        let clear = true;
        for (let y = feet; y <= standY + 1 && clear; y++) clear = blockAt(new Vec3(x, y, z))?.boundingBox === "empty";
        if (clear) return new Vec3(x, feet, z);
      }
    }
  }
  return null;
}

/**
 * Up to the top of a tree's crown the way a player does it: a pillar on the
 * ground just outside the crown, up to the crown's top, then across the
 * leaves to stand over the trunk. The pillar is its scaffolding (taken down
 * after). True when it stands over the trunk.
 */
async function climbBesideCrown(top: Vec3, crown: number): Promise<boolean> {
  const standY = crown + 1;
  const spot = pillarSpot(top, standY, (p) => bot.blockAt(p));
  if (!spot) return false;
  if (!(await goTo(new pf.goals.GoalBlock(spot.x, spot.y, spot.z), { timeoutMs: 20_000 })).ok) return false;
  const name = pillarBlockName();
  if (!name) return false;
  const { pillarUp } = await import("../core/primitives");
  const { recordScaffold } = await import("../core/scaffold");
  while (bot.entity.position.y < standY - 0.01) {
    if (isCommandCancelled()) return false;
    const feet = bot.entity.position.floored();
    if (!(await pillarUp(name)).ok) return false;
    recordScaffold(feet, name);
  }
  // Across the crown's top to over the trunk (walking on leaves, never digging them)
  const over = await pathing.withRules({ digCost: 100 }, () => goTo(new pf.goals.GoalBlock(top.x, standY, top.z), { timeoutMs: 15_000 }));
  return over.ok;
}

/** A block it pillars up with (dirt, cobblestone...), or null. */
function pillarBlockName(): string | null {
  const ids = (bot.pathfinder?.movements as unknown as { scafoldingBlocks?: number[] } | undefined)?.scafoldingBlocks ?? [];
  return bot.inventory.items().find((i) => ids.includes(i.type))?.name ?? null;
}

/** Blocks it carries that the walks pillar up on (dirt, cobblestone...). */
function pillarBlocks(): number {
  const ids = ((bot.pathfinder?.movements as unknown as { scafoldingBlocks?: number[] } | undefined)?.scafoldingBlocks ?? []);
  return bot.inventory.items().filter((i) => ids.includes(i.type)).reduce((n, i) => n + i.count, 0);
}

/** Waits (up to 1.5 s) until it stands on the ground again. */
async function landed(): Promise<void> {
  for (let t = 0; t < 30 && bot.entity && !bot.entity.onGround; t++) await new Promise((r) => setTimeout(r, 50));
}

// A trunk this tall or more is felled from its top
const TOP_DOWN_FROM = 3;

/**
 * Whether a trunk is felled from the top: one straight column of logs (not
 * acacia's crooked savanna trunk, not a wide 2x2 one), at least 3 tall.
 * Pure.
 */
export function fellFromTop(trunk: Array<{ name: string; position: { x: number; z: number } }>): boolean {
  if (trunk.length < TOP_DOWN_FROM || trunk.some((l) => l.name.startsWith("acacia"))) return false;
  const { x, z } = trunk[0]!.position;
  return trunk.every((l) => l.position.x === x && l.position.z === z);
}

/**
 * Fells a whole trunk (`trunk` bottom to top). From the top where it can
 * (owner: it stands on top of the trunk and grinds it down, no reaching up
 * through the leaves): it gets onto the top log (pillaring up beside it if
 * it must), then breaks the log under its feet, one after another, down to
 * the ground. Acacia (savanna), wide trunks, short ones, or no way up: from
 * the bottom as before. False when it was stopped.
 */
export async function fellTree(trunk: Block[]): Promise<boolean> {
  const top = trunk[trunk.length - 1]!.position;
  const at = (p: Vec3) => bot.blockAt(p);
  const crown = crownTop(top, at);
  // Only with blocks to pillar up on (game test: its first tree, empty bag,
  // it worked out a way up for 8 s, stalled, then cut it from the bottom)
  if (fellFromTop(trunk) && pillarBlocks() >= crown + 1 - trunk[0]!.position.y) {
    if (await climbBesideCrown(top, crown)) {
      // Down the column: the leaves over the trunk, then log after log
      for (let y = crown; y >= trunk[0]!.position.y; y--) {
        if (isCommandCancelled()) return false;
        const p = new Vec3(top.x, y, top.z);
        const b = at(p);
        if (!b || b.boundingBox === "empty") continue;
        if (!b.name.endsWith("_leaves") && !catalog().isTreeLog(b.name)) break;
        // Landed first: digging in the air is 5 times slower (game test:
        // every log took 4 seconds with a stone axe, started mid-drop)
        await landed();
        // The block under its feet (each break waits for the server; it drops onto the next)
        await breakBlockAt(p.x, p.y, p.z);
      }
      return true;
    }
    console.log(`Couldn't get up beside the ${trunk[0]!.name}'s crown at ${trunk[0]!.position}; from the bottom instead.`);
  }
  // A giant 2x2 trunk (jungle, dark oak, big spruce): only what it can reach
  // from the ground (game test: pillaring up a giant jungle tree for 2 logs,
  // it went round in circles placing and breaking one block for minutes)
  const wide = isGiant(trunk);
  const reach = trunk[0]!.position.y + 4;
  if (wide) console.log(`A giant ${trunk[0]!.name.replace(/_/g, " ")} tree: cutting what I can reach from the ground.`);
  for (const aLog of trunk) {
    if (isCommandCancelled()) return false;
    if (wide && aLog.position.y > reach) continue;
    // Log after log, like a player (each break already waits for the server)
    await breakBlockAt(aLog.position.x, aLog.position.y, aLog.position.z);
  }
  return true;
}

// Jungle trees taller than this (one trunk) are left standing (owner)
export const JUNGLE_LOGS_MAX = 6;

/**
 * True for a giant tree: a 2x2 trunk (jungle, dark oak, big spruce), two or
 * more logs side by side at its foot (acacia's crooked trunk starts as one).
 * Pure.
 */
export function isGiant(trunk: Array<{ position: { x: number; y: number; z: number } }>): boolean {
  if (trunk.length === 0) return false;
  const foot = Math.min(...trunk.map((l) => l.position.y));
  return new Set(trunk.filter((l) => l.position.y === foot).map((l) => `${l.position.x},${l.position.z}`)).size > 1;
}

/**
 * True for a tree it never cuts (owner, 2026-11-27): a giant 2x2 one, or a
 * jungle tree of more than JUNGLE_LOGS_MAX logs. Pure.
 */
export function leftStanding(trunk: Array<{ name: string; position: { x: number; y: number; z: number } }>): boolean {
  if (isGiant(trunk)) return true;
  return trunk.length > JUNGLE_LOGS_MAX && trunk.some((l) => l.name.startsWith("jungle"));
}

/** True for a trunk of more than one column of logs (a giant 2x2 tree). Pure. */
export function isWide(trunk: Array<{ position: { x: number; z: number } }>): boolean {
  return new Set(trunk.map((l) => `${l.position.x},${l.position.z}`)).size > 1;
}

/**
 * Helper function to count the number of logs in the inventory.
 * @returns The total number of logs.
 */
export function getLogsCount(): number {
  return bot.inventory
    .items()
    .filter((item) => catalog().isLog(item.name))
    .reduce((acc, item) => acc + item.count, 0);
}
