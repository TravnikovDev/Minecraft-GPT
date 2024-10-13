import { bot } from "../index";
import { breakBlockAt, pickupNearbyItems } from "../actions/worldInteraction";
import { goToPosition } from "../actions/movement";
import { __actionsDelay } from "../utils/utility";

/**
 * Gather wood blocks nearby to collect logs.
It should be separate function because a "log" names
 * @param num The number of wood logs to gather.
 * @param maxDistance The maximum distance to search for wood blocks.
 * @returns Whether the wood gathering was successful.
 */

export async function gatherWood(
  num: number,
  maxDistance = 64
): Promise<boolean> {
  const gatherWood = async () => {
    console.log(`Gathering wood... I need to make ${num} logs.`);

    const logsCount = bot.inventory
      .items()
      .filter((item) => item.name.includes("log"))
      .reduce((acc, item) => acc + item.count, 0);
    if (logsCount >= num) {
      console.log(`Wood gathering complete! I have ${logsCount} logs.`);
      return true;
    }

    const woodBlock = await bot.findBlock({
      matching: (block) => block.name.includes("log"),
      maxDistance,
    });
    if (woodBlock) {
      const destination = await goToPosition(
        woodBlock.position.x,
        woodBlock.position.y,
        woodBlock.position.z
      );
      if (destination) {
        try {
          await bot.pathfinder.stop();
          await breakBlockAt(
            woodBlock.position.x,
            woodBlock.position.y,
            woodBlock.position.z
          );
          await pickupNearbyItems(bot);
          await __actionsDelay(); // Add delay to simulate gathering
          return gatherWood(); // Repeat the process
        } catch (digError) {
          console.error("Failed to dig the wood block:", digError);
          return gatherWood();
        }
      }
    } else {
      console.log("No wood blocks found nearby.");
      return false;
    }
  };

  try {
    gatherWood();
  } catch (error) {
    console.error("Failed to gather wood:", error);
    return false;
  }

  return true;
}
