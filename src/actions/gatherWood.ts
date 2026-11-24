import { bot } from "../core/body";
import { Vec3 } from "vec3";
import { catalog } from "../core/catalog";
import { breakBlockAt, pickupNearbyItems } from "../actions/worldInteraction";
import { goToPosition, moveAway } from "../actions/movement";
import { __actionsDelay } from "../utils/utility";
import { isCommandCancelled } from "../core/commandContext";
import { findTrunk, isNaturalTree, rememberFelledTree, stumpsOf, treesToReplant } from "./forestry";
import { takeDownScaffolding } from "./scaffolding";

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

  try {
    let logsCount = getLogsCount();
    const startingLogs = logsCount;
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
        bot.chat(
          collected > 0
            ? `I could only find ${collected} of ${num} logs around here.`
            : `I couldn't find any trees nearby.`
        );
        return false;
      }

      console.log(`Looking for wood blocks nearby... (${logsCount}/${targetLogs})`);

      const woodBlock = bot.findBlock({
        matching: (block) => catalog().isTreeLog(block.name), // nether stems too, never stripped logs in builds
        useExtraInfo: (block) => !unreachable.has(block.position.toString()),
        maxDistance,
      });

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
        console.log(`Unable to reach the ${woodBlock.name} at ${woodBlock.position}; trying another.`);
        unreachable.add(woodBlock.position.toString());
        failedAttempts++;
        continue; // Try finding another wood block
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
        for (const aLog of aTree) {
          if (isCommandCancelled()) return false;
          await breakBlockAt(aLog.position.x, aLog.position.y, aLog.position.z);
          await __actionsDelay(1200); // Simulate gathering delay
        }
        // Off the pillar it built to reach the top, and its scaffolding gone,
        // before moving on (otherwise it bridges from tree to tree)
        await takeDownScaffolding();
        rememberFelledTree(stumps, woodBlock.name); // back for the saplings once the leaves fall
        await pickupNearbyItems(bot);
        await __actionsDelay(2500);
        const newCount = getLogsCount();
        failedAttempts = newCount > logsCount ? 0 : failedAttempts + 1;
        logsCount = newCount;
        console.log(`Collected logs. Total logs now: ${logsCount}.`);
      } catch (digError) {
        console.error("Failed to break the wood block:", digError);
        failedAttempts++;
        continue; // Attempt to find and break another wood block
      }
    }

    console.log(`Wood gathering complete! Total logs collected: ${logsCount}.`);
    if (treesToReplant() > 0) bot.chat("Once the leaves fall I'll pick up the saplings and replant the trees.");
    return true;
  } catch (error) {
    console.error("Failed to gather wood:", error);
    return false;
  }
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
