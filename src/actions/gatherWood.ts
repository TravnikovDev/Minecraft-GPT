import { bot } from "../index";
import { breakBlockAt, pickupNearbyItems } from "../actions/worldInteraction";
import { goToPosition, moveAway } from "../actions/movement";
import { __actionsDelay } from "../utils/utility";
import { getNearestBlocks } from "./world";

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
    console.log(`I currently have ${logsCount} logs.`);

    while (logsCount < num) {
      // Gather 1 extra log to account for any failures
      console.log(`Looking for wood blocks nearby...`, logsCount, num);

      const woodBlock = bot.findBlock({
        matching: (block) => block.name.includes("log"),
        maxDistance,
      });

      if (!woodBlock) {
        console.log("No wood blocks found nearby.");
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
        console.log("Unable to reach the wood block.");
        continue; // Try finding another wood block
      }

      const aTree = await getNearestBlocks(woodBlock.name, 5, 5);
      if (aTree.length === 0) {
        console.log("No wood blocks found nearby.");
        await moveAway(15);
        continue;
      }

      try {
        for (const aLog of aTree) {
          await breakBlockAt(aLog.position.x, aLog.position.y, aLog.position.z);
          await __actionsDelay(1200); // Simulate gathering delay
        }
        await pickupNearbyItems(bot);
        await __actionsDelay(2500);
        logsCount = getLogsCount();
        console.log(`Collected logs. Total logs now: ${logsCount}.`);
      } catch (digError) {
        console.error("Failed to break the wood block:", digError);
        continue; // Attempt to find and break another wood block
      }
    }

    console.log(`Wood gathering complete! Total logs collected: ${logsCount}.`);
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
    .filter((item) => item.name.includes("log"))
    .reduce((acc, item) => acc + item.count, 0);
}
