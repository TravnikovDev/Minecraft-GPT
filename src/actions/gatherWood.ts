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
  if (fellFromTop(trunk)) {
    const top = trunk[trunk.length - 1]!.position;
    const onTop = await pathing.withRules({ allow1by1towers: true }, () => goTo(new pf.goals.GoalBlock(top.x, top.y + 1, top.z)));
    if (onTop.ok) {
      for (let i = trunk.length - 1; i >= 0; i--) {
        if (isCommandCancelled()) return false;
        const p = trunk[i]!.position;
        // The log under its feet (each break waits for the server; it drops onto the next)
        await breakBlockAt(p.x, p.y, p.z);
      }
      return true;
    }
    console.log(`Couldn't get on top of the ${trunk[0]!.name} at ${trunk[0]!.position} (${onTop.ok ? "" : onTop.detail ?? onTop.reason}); from the bottom instead.`);
  }
  for (const aLog of trunk) {
    if (isCommandCancelled()) return false;
    // Log after log, like a player (each break already waits for the server)
    await breakBlockAt(aLog.position.x, aLog.position.y, aLog.position.z);
  }
  return true;
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
