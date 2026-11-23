// Path: src/actions/combat.ts

import { bot } from "../index";
import { Entity } from "prismarine-entity";
import { getAttackDamage, __actionsDelay } from "../utils/utility";
import { goals, Movements } from "mineflayer-pathfinder";
import vec3 from "vec3";

// Mob types with threat levels
export enum ThreatLevel {
  HIGH = 3,    // Creepers, etc.
  MEDIUM = 2,  // Skeletons, etc.
  LOW = 1,     // Zombies, spiders, etc.
  NEUTRAL = 0  // Only hostile when provoked
}

// Define standardized hostile mob information
export const hostileMobsInfo = {
  creeper: { threatLevel: ThreatLevel.HIGH, preferredDistance: 5, preferredWeapon: "bow" },
  skeleton: { threatLevel: ThreatLevel.MEDIUM, preferredDistance: 4, preferredWeapon: "shield" },
  zombie: { threatLevel: ThreatLevel.LOW, preferredDistance: 2, preferredWeapon: "sword" },
  spider: { threatLevel: ThreatLevel.LOW, preferredDistance: 2, preferredWeapon: "sword" },
  witch: { threatLevel: ThreatLevel.MEDIUM, preferredDistance: 4, preferredWeapon: "bow" },
  enderman: { threatLevel: ThreatLevel.NEUTRAL, preferredDistance: 3, preferredWeapon: "sword" },
  pillager: { threatLevel: ThreatLevel.MEDIUM, preferredDistance: 5, preferredWeapon: "shield" },
  phantom: { threatLevel: ThreatLevel.MEDIUM, preferredDistance: 5, preferredWeapon: "bow" },
  drowned: { threatLevel: ThreatLevel.LOW, preferredDistance: 3, preferredWeapon: "sword" },
  husk: { threatLevel: ThreatLevel.LOW, preferredDistance: 2, preferredWeapon: "sword" },
  stray: { threatLevel: ThreatLevel.MEDIUM, preferredDistance: 4, preferredWeapon: "shield" }
};

// Check if an Entity is Hostile - standardized function
export function isHostile(entity: Entity): boolean {
  if (!entity || !entity.name) return false;
  return Object.keys(hostileMobsInfo).includes(entity.name.toLowerCase());
}

// Get mob threat info
export function getMobThreatInfo(entity: Entity) {
  if (!entity || !entity.name) return null;
  const mobName = entity.name.toLowerCase();
  return hostileMobsInfo[mobName] || null;
}

// Get entities sorted by priority (threat level and distance)
export function getPriorityTargets(range = 16): Entity[] {
  const hostileEntities = Object.values(bot.entities).filter(
    (entity) =>
      entity.type === "mob" &&
      entity.position.distanceTo(bot.entity.position) <= range &&
      isHostile(entity)
  );

  // Sort by threat level (high to low) and then by distance (close to far)
  return hostileEntities.sort((a, b) => {
    const threatA = getMobThreatInfo(a)?.threatLevel || 0;
    const threatB = getMobThreatInfo(b)?.threatLevel || 0;
    
    // First sort by threat level
    if (threatB !== threatA) {
      return threatB - threatA;
    }
    
    // If same threat level, sort by distance
    return a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position);
  });
}

// Attack a Specific Entity
export async function attackEntity(targetEntity: Entity): Promise<boolean> {
  try {
    // Choose appropriate weapon based on enemy type
    await chooseWeaponForTarget(targetEntity);
    
    // Choose appropriate tactics
    await useTacticsForTarget(targetEntity);
    
    // Attack
    await bot.pvp.attack(targetEntity);
    bot.chat(`Attacking ${targetEntity.name}!`);
    return true;
  } catch (error) {
    console.error("Error while attacking entity:", error);
    return false;
  }
}

// Defend Against Nearby Hostiles with prioritization
export async function defendSelf(range = 16): Promise<boolean> {
  try {
    const priorityTargets = getPriorityTargets(range);
    
    if (priorityTargets.length > 0) {
      const target = priorityTargets[0];
      
      // Choose appropriate weapon and tactics for highest priority target
      await chooseWeaponForTarget(target);
      await useTacticsForTarget(target);
      
      bot.pvp.attack(target);
      bot.chat(`Defending myself against ${target.name} (threat level: ${getMobThreatInfo(target)?.threatLevel})!`);
      return true;
    } else {
      bot.chat(`No hostile entities found nearby to defend against.`);
      return false;
    }
  } catch (error) {
    console.error("Error while defending self:", error);
    return false;
  }
}

// Stop Combat
export async function stopCombat(): Promise<void> {
  try {
    bot.pvp?.stop();
    bot.pathfinder.setGoal(null);
    bot.chat("Stopping combat.");
  } catch (error) {
    console.error("Error while stopping combat:", error);
  }
}

// Choose the best weapon for a specific target
export async function chooseWeaponForTarget(target: Entity): Promise<boolean> {
  try {
    const threatInfo = getMobThreatInfo(target);
    if (!threatInfo) return await equipBestWeapon(); // Default if no specific info
    
    const preferredWeapon = threatInfo.preferredWeapon;
    
    // Try to equip preferred weapon type first
    if (preferredWeapon === "bow") {
      // Try to equip bow
      const bows = bot.inventory.items().filter(item => 
        item.name.includes("bow") && !item.name.includes("crossbow"));
      
      if (bows.length > 0) {
        await bot.equip(bows[0], "hand");
        // Check if we have arrows
        const arrows = bot.inventory.items().filter(item => 
          item.name.includes("arrow"));
        
        if (arrows.length > 0) {
          bot.chat(`Equipped ${bows[0].displayName} for ranged combat.`);
          return true;
        }
      }
      
      // If no bow or arrows, try crossbow
      const crossbows = bot.inventory.items().filter(item => 
        item.name.includes("crossbow"));
      
      if (crossbows.length > 0 && bot.inventory.items().some(item => item.name.includes("arrow"))) {
        await bot.equip(crossbows[0], "hand");
        bot.chat(`Equipped ${crossbows[0].displayName} for ranged combat.`);
        return true;
      }
    } 
    else if (preferredWeapon === "shield") {
      // Try to equip shield in offhand and best melee weapon in main hand
      const shields = bot.inventory.items().filter(item => item.name.includes("shield"));
      if (shields.length > 0) {
        await bot.equip(shields[0], "off-hand");
        bot.chat(`Equipped shield for defense.`);
      }
      // Also equip best melee weapon
      return await equipBestMeleeWeapon();
    }
    
    // Default: equip best melee weapon
    return await equipBestMeleeWeapon();
  } catch (error) {
    console.error("Error while choosing weapon for target:", error);
    return false;
  }
}

// Equip best melee weapon
export async function equipBestMeleeWeapon(): Promise<boolean> {
  try {
    let weapons = bot.inventory
      .items()
      .filter(
        (item) =>
          item.name.includes("sword") ||
          (item.name.includes("axe") && !item.name.includes("pickaxe"))
      );
    if (weapons.length === 0) {
      weapons = bot.inventory
        .items()
        .filter(
          (item) =>
            item.name.includes("pickaxe") || item.name.includes("shovel")
        );
    }
    if (weapons.length === 0) {
      bot.chat("No weapon available to equip.");
      return false;
    }

    weapons.sort((a, b) => getAttackDamage(b) - getAttackDamage(a));
    const bestWeapon = weapons[0];
    await bot.equip(bestWeapon, "hand");
    bot.chat(`Equipped ${bestWeapon.displayName} for combat.`);
    return true;
  } catch (error) {
    console.error("Error while equipping best weapon:", error);
    return false;
  }
}

// Use appropriate tactics for different mob types
export async function useTacticsForTarget(target: Entity): Promise<void> {
  if (!target || !target.name) return;
  
  const threatInfo = getMobThreatInfo(target);
  if (!threatInfo) return;
  
  const targetName = target.name.toLowerCase();
  const preferredDistance = threatInfo.preferredDistance;
  
  // Stop any existing movement
  bot.pathfinder.setGoal(null);
  
  try {
    // Use appropriate movement pattern based on mob type
    if (targetName === "creeper") {
      // For creepers: maintain distance, never get too close
      await maintainDistance(target, Math.max(preferredDistance, 4));
      bot.chat("Keeping distance from creeper!");
    } 
    else if (targetName === "skeleton" || targetName === "stray") {
      // For skeletons: strafe to avoid arrows and use shield
      await strafeAroundTarget(target, preferredDistance);
      
      // Try to use shield when skeleton is about to shoot
      if (target.metadata && target.metadata[8]) { // 8 is the index for "is drawing bow" in metadata
        await useShield();
      }
    }
    else if (targetName === "phantom") {
      // For phantoms: they fly, so use ranged weapons and look up
      bot.lookAt(target.position);
    }
    else {
      // For other mobs: approach to attack or maintain optimal distance for ranged
      const equipment = bot.inventory.slots[bot.getEquipmentDestSlot('hand')];
      const isRanged = equipment && (equipment.name.includes("bow") || equipment.name.includes("crossbow"));
      
      if (isRanged) {
        await maintainDistance(target, preferredDistance);
      } else {
        // For melee, get close but use optimal fighting position
        bot.pathfinder.setMovements(new Movements(bot));
        bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
      }
    }
  } catch (error) {
    console.error("Error using tactics:", error);
  }
}

// Function to maintain a specific distance from target
async function maintainDistance(target: Entity, distance: number): Promise<void> {
  const currentDistance = bot.entity.position.distanceTo(target.position);
  
  if (Math.abs(currentDistance - distance) < 1) {
    // Already at good distance
    return;
  }
  
  if (currentDistance < distance) {
    // Too close, back away
    const vectorAway = bot.entity.position.minus(target.position).normalize().scale(distance);
    const targetPosition = bot.entity.position.plus(vectorAway);
    
    bot.pathfinder.setMovements(new Movements(bot));
    bot.pathfinder.setGoal(new goals.GoalBlock(
      targetPosition.x, 
      targetPosition.y, 
      targetPosition.z
    ), true);
  } else {
    // Too far, get closer
    bot.pathfinder.setMovements(new Movements(bot));
    bot.pathfinder.setGoal(new goals.GoalFollow(target, distance), true);
  }
}

// Function to strafe around a target to avoid projectiles
async function strafeAroundTarget(target: Entity, distance: number): Promise<void> {
  // Calculate a point to the side of the target
  const directionToTarget = target.position.minus(bot.entity.position).normalize();
  
  // Create a perpendicular vector (for strafing)
  const strafeVector = vec3(directionToTarget.z, 0, -directionToTarget.x).normalize().scale(distance);
  
  // Alternate strafing direction based on time
  const direction = Date.now() % 6000 < 3000 ? 1 : -1; 
  const targetPosition = target.position.plus(strafeVector.scale(direction));
  
  bot.pathfinder.setMovements(new Movements(bot));
  bot.pathfinder.setGoal(new goals.GoalBlock(
    targetPosition.x, 
    targetPosition.y, 
    targetPosition.z
  ), true);
}

// Function to use shield for blocking
async function useShield(): Promise<boolean> {
  try {
    // Check if we have a shield in inventory
    const shields = bot.inventory.items().filter(item => item.name.includes("shield"));
    
    if (shields.length > 0) {
      // Equip shield in off-hand if not already equipped
      const currentOffhand = bot.inventory.slots[bot.getEquipmentDestSlot('off-hand')];
      if (!currentOffhand || !currentOffhand.name.includes("shield")) {
        await bot.equip(shields[0], "off-hand");
      }
      
      // Activate shield (right click)
      bot.activateItem(true); // true for offhand
      await __actionsDelay(500); // Block for a moment
      
      // Stop blocking
      bot.deactivateItem();
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error using shield:", error);
    return false;
  }
}

// Night time self-defense system
export async function nightDefense(checkInterval = 10000): Promise<void> {
  bot.chat("Enabling night defense system. Will defend against mobs during the night.");
  
  // Periodic check function
  const checkForHostiles = async () => {
    try {
      // Check if it's night time (time between 13000 and 23000)
      const timeOfDay = bot.time.timeOfDay;
      const isNight = timeOfDay >= 13000 && timeOfDay < 23000;
      
      if (isNight) {
        // In night time, check for hostiles
        const hostiles = getPriorityTargets(16);
        
        if (hostiles.length > 0) {
          bot.chat("Night defense activated! Hostile mobs detected.");
          await defendSelf(16);
        }
      }
    } catch (error) {
      console.error("Error in night defense system:", error);
    }
  };
  
  // Run check immediately
  await checkForHostiles();
  
  // Set interval to periodically check
  const intervalId = setInterval(checkForHostiles, checkInterval);
  
  // Store interval ID so it can be cleared later
  // @ts-ignore - adding a custom property
  bot.nightDefenseInterval = intervalId;
  
  // Clear interval when bot is disconnected
  bot.once('end', () => {
    clearInterval(intervalId);
  });
}

// Stop night defense system
export function stopNightDefense(): void {
  // @ts-ignore - accessing custom property
  if (bot.nightDefenseInterval) {
    // @ts-ignore
    clearInterval(bot.nightDefenseInterval);
    // @ts-ignore
    bot.nightDefenseInterval = null;
    bot.chat("Night defense system disabled.");
  }
}

// Equip Best Weapon (general function - kept for backward compatibility)
export async function equipBestWeapon(): Promise<boolean> {
  return await equipBestMeleeWeapon();
}
