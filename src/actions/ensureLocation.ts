import { bot } from "..";
import { isHuntable } from "../utils/minecraftData";
import { goToPosition, moveAway } from "./movement";
import {
  getNearestBlocks,
  getBiomeName,
  getNearbyEntities,
  getNearestFreeSpace,
} from "./world"; // Assuming these are imported from your helpers

export async function ensureLocation(
  radius: number = 120,
  requiredResources: {
    wood: number;
    coal: number;
    iron: number;
    stone: number;
    sand: number;
    animals: number;
  } = {
    wood: 48,
    coal: 64 * 2,
    iron: 62 * 2,
    stone: 64 * 6,
    sand: 24,
    animals: 4,
  }
): Promise<boolean> {
  console.log(
    `Scanning location with radius ${radius} for required resources:`,
    requiredResources
  );

  const { wood, coal, iron, stone, sand, animals } = requiredResources;

  while (true) {
    // Initialize resource counters
    let woodCount = 0;
    let coalCount = 0;
    let ironCount = 0;
    let stoneCount = 0;
    let sandCount = 0;
    let animalCount = 0;

    // Scan for resources using helper functions
    const woodBlocks = bot.findBlocks({
      matching: (block) => block.name.includes("log"),
      maxDistance: radius,
      count: wood,
    });
    woodCount = woodBlocks ? woodBlocks.length : 0;

    const coalBlocks = getNearestBlocks("coal_ore", radius, coal);
    coalCount = coalBlocks.length;

    const ironBlocks = getNearestBlocks("iron_ore", radius, iron);
    ironCount = ironBlocks.length;

    const stoneBlocks = getNearestBlocks("stone", radius, stone); // 20 as example count
    stoneCount = stoneBlocks.length;

    const sandBlocks = getNearestBlocks("sand", radius, stone); // Limit sand to avoid island
    sandCount = sandBlocks.length;

    // Scan for animals (farming and food)
    const animalsNearby = getNearbyEntities(radius).filter((entity) =>
      isHuntable(entity)
    );
    animalCount = animalsNearby.length;

    // Terrain flatness check using helper function
    // 8x8 of flat area is good for base
    const flatTerrain = getNearestFreeSpace(3, radius);
    console.log(`Flat terrain: ${flatTerrain}`);
    const terrainIsFlat = flatTerrain !== undefined;

    // Check biome suitability
    const biome = getBiomeName();
    console.log(`Biome: ${biome}`);
    const biomeIsSuitable = ![
      "ocean",
      "peaks",
      "snowy",
      "beach",
      "ice",
      "desert",
    ].includes(biome);

    console.log(
      `Resources found - Wood: ${woodCount}, Coal: ${coalCount}, Iron: ${ironCount}, Stone: ${stoneCount}, Sand: ${sandCount}, Animals: ${animalCount}`
    );

    // Check all conditions for a good location
    // Detailed report of the location
    if (
      woodCount >= wood &&
      coalCount >= coal &&
      ironCount >= iron &&
      stoneCount >= stone &&
      animalCount >= animals &&
      terrainIsFlat &&
      biomeIsSuitable
    ) {
      await goToPosition(flatTerrain.x, flatTerrain.y, flatTerrain.z);
      bot.chat(
        `Success! This location is suitable for a base, radius of ${radius} blocks we have: 
          - Wood: ${woodCount} ✅
          - Coal: ${coalCount} ✅
          - Iron: ${ironCount} ✅
          - Stone: ${stoneCount} ✅
          - Sand: ${sandCount} ✅
          - Animals: ${animalCount} ✅
          - Flat terrain ✅
          - Biome is suitable ✅`
      );
      return true;
    } else {
      // Detailed failure report
      const issues = [];
      if (woodCount < wood) issues.push(`Wood: ${woodCount}/${wood} ❌`);
      if (coalCount < coal) issues.push(`Coal: ${coalCount}/${coal} ❌`);
      if (ironCount < iron) issues.push(`Iron: ${ironCount}/${iron} ❌`);
      if (stoneCount < stone) issues.push(`Stone: ${stoneCount}/${stone} ❌`);
      if (sandCount < sand) issues.push(`Sand: ${sandCount}/${sand} ❌`);
      if (animalCount < animals)
        issues.push(`Animals: ${animalCount}/${animals} ❌`);
      if (!terrainIsFlat) issues.push("Terrain is not flat ❌");
      if (!biomeIsSuitable) issues.push(`Biome (${biome}) is not suitable ❌`);

      bot.chat(
        `This location is not suitable for a base due to the following issues:
        ${issues.join("\n")}`
      );

      // Move away and try again
      await moveAway(100);
    }
  }
}
