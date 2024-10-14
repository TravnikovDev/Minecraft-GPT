import { Vec3 } from "vec3";
import { bot } from "..";

// Helper function to place dirt if there's a hole
async function fillHole(pos: Vec3) {
  const dirt = bot.inventory.items().find((item) => item.name === "dirt");
  if (!dirt) {
    bot.chat("No dirt available to fill holes.");
    return;
  }

  const blockBelow = bot.blockAt(pos.offset(0, -1, 0));
  if (blockBelow && blockBelow.name === "air") {
    await bot.placeBlock(bot.blockAt(pos.offset(0, -2, 0)), dirt);
    bot.chat(`Filled hole at ${pos.toString()} with dirt.`);
  }
}

export async function clearSite(
  startPosition: Vec3,
  width: number = 8,
  length: number = 8,
  height: number = 6
) {
  // Clear and flatten the area
  for (let x = -Math.floor(width / 2); x <= Math.floor(width / 2); x++) {
    for (let z = -Math.floor(length / 2); z <= Math.floor(length / 2); z++) {
      for (let y = 0; y < height; y++) {
        const currentPos = startPosition.offset(x, y, z);
        const block = bot.blockAt(currentPos);

        if (block && block.name !== "air") {
          // Dig the block if it's not at ground level
          if (currentPos.y > startPosition.y) {
            await bot.dig(block);
            bot.chat(`Cleared block at ${currentPos.toString()}.`);
          }
        } else if (currentPos.y === startPosition.y) {
          // Fill the hole if it's at ground level
          await fillHole(currentPos);
        }
      }
    }
  }
}
export async function buildShelter() {}
export async function buildShack() {}
export async function buildWoodenHouse() {}
export async function buildStoneHouse() {}

// TBD
export async function buildCastle() {}
export async function buildFortress() {}
export async function buildTower() {}
