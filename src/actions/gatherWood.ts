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
  const gatherWoodInternal = async () => {
    console.log(`Gathering wood... I need to make ${num} logs.`);

    const logsCount = bot.inventory
      .items()
      .filter((item) => item.name.includes("log"))
      .reduce((acc, item) => acc + item.count, 0);

    console.log(`I have ${logsCount} logs.`);
    if (logsCount >= num) {
      console.log(`Wood gathering complete! I have ${logsCount} logs.`);
      bot.chat(`I have gathered ${logsCount} logs.`);
      return true;
    }

    const woodBlock = bot.findBlock({
      matching: (block) => block.name.includes("log"),
      maxDistance,
    });

    if (woodBlock) {
      const destination = await goToPosition(
        woodBlock.position.x,
        woodBlock.position.y,
        woodBlock.position.z,
        1
      );

      if (destination) {
        try {
          for (let i = 0; i < 4; i++) {
            console.log("Trying to break the wood block. number:", i);
            await breakBlockAt(
              woodBlock.position.x,
              woodBlock.position.y + i,
              woodBlock.position.z
            );
            console.log("Successfully broke the wood block.");
            await __actionsDelay(2000); // Add delay to simulate gathering
          }
          await pickupNearbyItems(bot);
          console.log("Successfully gathered a wood block.");
          return gatherWoodInternal(); // Repeat the process if needed
        } catch (digError) {
          console.error("Failed to dig the wood block:", digError);
          return gatherWoodInternal();
        }
      }
    } else {
      console.log("No wood blocks found nearby.");
      return false;
    }
  };

  try {
    await gatherWoodInternal();
    return true;
  } catch (error) {
    console.error("Failed to gather wood:", error);
    return false;
  }
}
