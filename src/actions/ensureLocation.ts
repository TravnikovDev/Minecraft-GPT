import { bot } from "..";
import { Vec3 } from "vec3"; // Add this import statement
import { isHuntable } from "../utils/minecraftData";
import { moveAway } from "./movement";
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
): Promise<Vec3> {
  console.log(
    `Scanning location with radius ${radius} for required resources:`,
    requiredResources
  );

  const { wood, coal, iron, stone, sand, animals } = requiredResources;

  while (true) {
    await moveAway(30);

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
    if (woodCount < wood) continue;

    const coalBlocks = getNearestBlocks("coal_ore", radius, coal);
    coalCount = coalBlocks.length;
    if (coalCount < coal) continue;

    const ironBlocks = getNearestBlocks("iron_ore", radius, iron);
    ironCount = ironBlocks.length;
    if (ironCount < iron) continue;

    const stoneBlocks = getNearestBlocks("stone", radius, stone); // 20 as example count
    stoneCount = stoneBlocks.length;
    if (stoneCount < stone) continue;

    const sandBlocks = getNearestBlocks("sand", radius, stone); // Limit sand to avoid island
    sandCount = sandBlocks.length;
    if (sandCount < sand) continue;

    // Scan for animals (farming and food)
    const animalsNearby = getNearbyEntities(radius).filter((entity) =>
      isHuntable(entity)
    );
    animalCount = animalsNearby.length;
    if (animalCount < animals) continue;

    // Terrain flatness check using helper function
    // 8x8 of flat area is good for base
    const possibleBasePosition = getNearestFreeSpace(3, radius);
    console.log(`Flat terrain: ${possibleBasePosition}`);
    const terrainIsFlat = possibleBasePosition !== undefined;
    if (!terrainIsFlat) continue;

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
    if (!biomeIsSuitable) continue;

    // Cave/Ravine detection under the flat terrain within half the radius
    const caveDetected = await checkForCavesBelow(possibleBasePosition);
    if (caveDetected) {
      console.log(
        "Detected large cave under the flat terrain. Not safe for building."
      );
      continue;
    }

    // Check for large lakes or rivers nearby within a radius of 12 blocks
    const waterNearby = await checkForWaterNearby(possibleBasePosition);
    if (waterNearby) {
      console.log(
        "Detected large lake or river nearby. Not safe for building."
      );
      continue;
    }

    // Check all conditions for a good location
    if (
      woodCount >= wood &&
      coalCount >= coal &&
      ironCount >= iron &&
      stoneCount >= stone &&
      animalCount >= animals &&
      terrainIsFlat &&
      biomeIsSuitable &&
      !caveDetected && // Ensure no cave detected
      !waterNearby // Ensure no large water body nearby
    ) {
      bot.chat(
        `Success! This location is suitable for a base, radius of ${radius} blocks we have: 
        1. Resources ✅ 2. Flat terrain ✅ 3. Biome is suitable ✅ 4. No caves below base ✅ 5. No large water bodies nearby ✅`
      );
      return possibleBasePosition;
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
      if (waterNearby) issues.push("Detected a large lake or river nearby ❌");

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
  position: Vec3 | undefined,
  checkRadius = 8
): Promise<boolean> {
  if (!position) return false; // No flat terrain means no need to check

  console.log(
    `Checking for caves beneath the flat terrain within radius of ${checkRadius}`
  );

  // Check 20 blocks below the surface
  const blocksBelow = bot.findBlocks({
    matching: (block) => block.name === "air", // Detect air blocks, indicating a cave
    maxDistance: checkRadius,
    count: 100,
    point: position.offset(0, -checkRadius / 2, 0), // Start at flatTerrain position
  });

  if (blocksBelow.length > Math.pow(checkRadius, 3) * 0.2) {
    // If there are a significant number of air blocks (indicating a large cave)
    return true; // Large cave detected
  }

  return false; // No significant caves detected
}

// Function to check for large lakes or rivers nearby within a given radius
async function checkForWaterNearby(
  position: Vec3 | undefined,
  checkRadius: number = 12,
  percent: number = 0.15
): Promise<boolean> {
  if (!position) return false; // No flat terrain means no need to check

  console.log(
    `Checking for water bodies nearby within radius of ${checkRadius}`
  );

  // Scan for water blocks within the specified radius
  const waterBlocks = bot.findBlocks({
    matching: (block) => block.name === "water",
    maxDistance: checkRadius,
    count: Math.pow(checkRadius, 3) * percent,
    point: position.offset(0, -checkRadius / 2, 0), // Start at flatTerrain position
  });

  if (waterBlocks.length > Math.pow(checkRadius, 3) * percent) {
    // If a significant number of water blocks are found, assume there's a large lake/river
    return true; // Large water body detected
  }

  return false; // No significant water bodies detected
}
