// Path: src/actions/BuildStoneHouse.ts

import { z } from "zod";
import { BotActions } from "./types";
import { bot } from "../index";
import { Vec3 } from "vec3";
import { placeBlock } from "../utils/worldInteraction";

// Define parameters for BuildStoneHouse action
export const parameters = z.object({
  width: z.number().optional().describe("Width of the house"),
  length: z.number().optional().describe("Length of the house"),
  height: z.number().optional().describe("Height of the house"),
});

// Implement the BuildStoneHouse action
export async function execute(args: any) {
  console.log(`Executing BuildStoneHouse with args:`, args);

  // Validate arguments
  let parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for BuildStoneHouse:`, parsed.error);
    return;
  }

  let { width, length, height } = parsed.data;
  // Default values for room size
  width = width || 5;
  length = length || 6;
  height = height || 5;

  const startPosition = bot.entity.position.clone();
  const cobblestone = bot.inventory
    .items()
    .find((item) => item.name === "cobblestone");
  const wood = bot.inventory.items().find((item) => item.name === "planks");

  // Build the cobblestone walls
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      for (let z of [0, length - 1]) {
        const wallPosition = startPosition.offset(x, y, z);
        await placeBlock("cobblestone", x, y, z);
      }
    }
  }
  for (let z = 0; z < length; z++) {
    for (let y = 0; y < height; y++) {
      for (let x of [0, width - 1]) {
        const wallPosition = startPosition.offset(x, y, z);
        await placeBlock("cobblestone", x, y, z);
      }
    }
  }
  bot.chat("Built the walls of the stone house.");

  // Build the wooden roof
  const roofY = startPosition.y + height;
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < length; z++) {
      const roofPosition = startPosition.offset(x, height - 1, z);
      await placeBlock("oak_planks", x, roofY, z);
    }
  }
  bot.chat("Added the wooden roof to the stone house.");

  // Place essential items inside the house
  async function placeItem(itemName: string, positionOffset: Vec3) {
    const item = bot.inventory.items().find((i) => i.name === itemName);
    if (item) {
      const targetPos = startPosition.offset(
        positionOffset.x,
        0,
        positionOffset.z
      );
      await placeBlock(item.name, targetPos.x, targetPos.y, targetPos.z);
      bot.chat(`Placed ${itemName} in the house.`);
    } else {
      bot.chat(`${itemName} is missing in inventory.`);
    }
  }

  // Place furniture inside the house
  await placeItem("crafting_table", new Vec3(1, 0, 1));
  await placeItem("furnace", new Vec3(1, 0, 2));
  await placeItem("bed", new Vec3(1, 0, 3));
  await placeItem("chest", new Vec3(2, 0, 1));
  await placeItem("chest", new Vec3(2, 0, 2));

  // Place torches on the walls
  const torch = bot.inventory.items().find((item) => item.name === "torch");
  if (torch) {
    for (let y = 1; y <= 2; y++) {
      const torchPositions = [
        new Vec3(0, y, 0),
        new Vec3(width - 1, y, 0),
        new Vec3(0, y, length - 1),
        new Vec3(width - 1, y, length - 1),
      ];
      for (const pos of torchPositions) {
        const torchPlacePos = startPosition.offset(pos.x, pos.y, pos.z);
        await placeBlock(
          "wall_§torch",
          torchPlacePos.x,
          torchPlacePos.y,
          torchPlacePos.z
        );
        bot.chat(`Placed torch at ${torchPlacePos.toString()}`);
      }
    }
  }

  bot.chat("Stone house setup complete.");
}
