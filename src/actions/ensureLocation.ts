import { bot } from "..";
import { Vec3 } from "vec3"; // Add this import statement
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

    // Cave/Ravine detection under the flat terrain within half the radius
    const caveDetected = await checkForCavesBelow(flatTerrain);
    if (caveDetected) {
      console.log(
        "Detected large cave under the flat terrain. Not safe for building."
      );
    }

    console.log(
      `Resources found - Wood: ${woodCount}, Coal: ${coalCount}, Iron: ${ironCount}, Stone: ${stoneCount}, Sand: ${sandCount}, Animals: ${animalCount}`
    );

    // Check all conditions for a good location
    if (
      woodCount >= wood &&
      coalCount >= coal &&
      ironCount >= iron &&
      stoneCount >= stone &&
      animalCount >= animals &&
      terrainIsFlat &&
      biomeIsSuitable &&
      !caveDetected // Ensure no cave detected
    ) {
      await goToPosition(flatTerrain.x, flatTerrain.y, flatTerrain.z);
      bot.chat(
        `Success! This location is suitable for a base, radius of ${radius} blocks we have: 
        1. Resources ✅ 2. Flat terrain ✅ 3. Biome is suitable ✅ 4. No caves below base ✅`
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
      if (caveDetected)
        issues.push(
          "Detected a large cave below the possible base location ❌"
        );

      bot.chat(
        `This location is not suitable for a base due to the following issues:
        ${issues.join("\n")}`
      );

      // Move away and try again
      await moveAway(100);
    }
  }
}

// Function to check for large caves directly beneath the flat terrain within half the radius
async function checkForCavesBelow(
  flatTerrain: Vec3 | undefined
): Promise<boolean> {
  if (!flatTerrain) return false; // No flat terrain means no need to check

  const checkRadius = 8;

  console.log(
    `Checking for caves beneath the flat terrain within radius of ${checkRadius}`
  );

  // Check 20 blocks below the surface
  const blocksBelow = bot.findBlocks({
    matching: (block) => block.name === "air", // Detect air blocks, indicating a cave
    maxDistance: checkRadius,
    count: 100,
    point: flatTerrain.offset(0, -checkRadius / 2, 0), // Start at flatTerrain position
  });

  if (blocksBelow.length > Math.pow(checkRadius, 3) * 0.2) {
    // If there are a significant number of air blocks (indicating a large cave)
    return true; // Large cave detected
  }

  return false; // No significant caves detected
}
