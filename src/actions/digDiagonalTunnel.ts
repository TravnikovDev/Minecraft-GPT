import { bot } from "../index";
import {
  breakBlockAt,
  pickupNearbyItems,
  placeBlock,
} from "../actions/worldInteraction";
import { craftRecipe } from "../actions/crafting";
import { __actionsDelay } from "../utils/utility";
import { saveMineLocation } from "../managers/persistenceManager";
import { Vec3 } from "vec3";

export type DirectionType = "north" | "south" | "west" | "east";

/**
 * Digs a diagonal tunnel in the specified direction.
 * @param direction The direction to dig the tunnel in.
 * @param depth The depth of the tunnel.
 * @param tunnelSize The size of the tunnel.
 * @param torchInterval The interval at which to place torches.
 * @returns A promise that resolves to a boolean indicating whether the tunnel was successfully dug.
 */
export async function digDiagonalTunnel(
  direction: DirectionType = "north",
  depth: number = 10,
  tunnelSize: { width: number; height: number } = { width: 1, height: 4 },
  startPosition?: Vec3,
  tunnelName: string = `Tunnel-${direction}-${depth}`,
  torchInterval: number = 12
): Promise<boolean> {
  if (!startPosition) startPosition = bot.entity.position.clone();

  const offsetX = direction === "east" ? 1 : direction === "west" ? -1 : 0;
  const offsetZ = direction === "south" ? 1 : direction === "north" ? -1 : 0;

  for (let w = 0; w < tunnelSize.width; w++) {
    const wOffsetX = direction === "north" || direction === "south" ? w : 0;
    const wOffsetZ = direction === "east" || direction === "west" ? w : 0;

    for (let i = 1; i <= depth; i++) {
      const basePosition = startPosition.offset(
        wOffsetX + i * offsetX,
        -i,
        wOffsetZ + i * offsetZ
      );

      for (let h = 0; h < tunnelSize.height; h++) {
        const digPosition = basePosition.offset(0, h, 0);
        const digResult = await breakBlockAt(
          digPosition.x,
          digPosition.y,
          digPosition.z
        );
        await __actionsDelay(digResult ? 1000 : 200);
      }

      await pickupNearbyItems(bot);

      if (i % torchInterval === 0 && w === tunnelSize.width - 1) {
        const torchPosition = basePosition.offset(0, 2, 0);
        const torch = bot.inventory
          .items()
          .find((item) => item.name === "torch");
        if (torch) {
          await placeBlock(
            "wall_torch",
            torchPosition.x,
            torchPosition.y,
            torchPosition.z,
            "side"
          );
          bot.chat(`Placed torch at ${torchPosition.toString()}`);
        }
      }
    }
  }

  bot.chat(`I've dug ${tunnelName}`);

  if (tunnelName !== "basementEntrance")
    saveMineLocation({
      name: tunnelName,
      direction,
      startsAt: startPosition,
      endsAt: startPosition.offset(depth * offsetX, -depth, depth * offsetZ),
      depth,
    });

  /* const cobblestoneCount = bot.inventory
    .items()
    .filter((item) => item.name.includes("cobblestone"))
    .reduce((acc, item) => acc + item.count, 0);
  const stairsNeeded = Math.floor(depth * tunnelSize.width);
  const cobblestonesNeeded = Math.ceil(stairsNeeded / 0.66);

  if (cobblestoneCount >= cobblestonesNeeded) {
    await craftRecipe("cobblestone_stairs", stairsNeeded);
    bot.chat(`Crafted ${stairsNeeded} cobblestone stairs.`);
  } else {
    bot.chat(
      `Not enough cobblestone! I have ${cobblestoneCount} and I need ${cobblestonesNeeded} blocks.`
    );
  }

  for (let i = 1; i <= depth; i++) {
    for (let w = 0; w < tunnelSize.width; w++) {
      const wOffsetX = direction === "north" || direction === "south" ? w : 0;
      const wOffsetZ = direction === "east" || direction === "west" ? w : 0;

      const stairPosition = startPosition.offset(
        wOffsetX + i * offsetX,
        -i,
        wOffsetZ + i * offsetZ
      );
      const stairs = bot.inventory
        .items()
        .find((item) => item.name === "cobblestone_stairs");
      if (stairs) {
        await placeBlock(
          "cobblestone_stairs",
          stairPosition.x,
          stairPosition.y,
          stairPosition.z,
          "bottom"
        );
        bot.chat(`Placed cobblestone stair at ${stairPosition.toString()}`);
      }
    }
  } */

  return true;
}
