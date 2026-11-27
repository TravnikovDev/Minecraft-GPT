// Path: src/actions/combat.ts

import { bot } from "../core/body";
import { on } from "../core/events";
import { chatter } from "../core/narrator";
import { equipItem, lookAt } from "../core/primitives";
import { stopUsingItem, useHeldItem } from "../core/primitives";
import type { Item } from "prismarine-item";
import { catalog } from "../core/catalog";
import { Entity } from "prismarine-entity";
import { getAttackDamage, __actionsDelay } from "../utils/utility";
import { goals } from "mineflayer-pathfinder";
import { setHurry, walkingRules } from "../core/movements";
import vec3 from "vec3";
import { fighting, pathing } from "../core/plugins";
import { mobsOut } from "../core/daylight";

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

/**
 * Mobs the game calls hostile that leave a player alone unless provoked (an
 * enderman looked at, a zombified piglin hit, a piglin without gold seen),
 * or that a fight goes badly with (the warden). Attacking one starts a war
 * the bot can't win: a guard never picks them (architect review: the guard
 * would start a pigman war in the Nether).
 */
export const NEUTRAL_MOBS = new Set(["enderman", "zombified_piglin", "piglin", "piglin_brute", "warden", "wolf", "bee", "polar_bear", "llama", "trader_llama", "panda", "dolphin", "goat", "iron_golem"]);

/** Spiders and cave spiders leave players alone by day (in light). Pure. */
export const isNeutralNow = (name: string, night: boolean): boolean =>
  NEUTRAL_MOBS.has(name) || (!night && (name === "spider" || name === "cave_spider"));

// Check if an Entity is Hostile - standardized function
/** A hostile mob: the game's own list (core/catalog), plus the ones the threat table knows. */
export function isHostile(entity: Entity): boolean {
  if (!entity || !entity.name) return false;
  const name = entity.name.toLowerCase();
  return catalog().isHostile(name) || name in hostileMobsInfo;
}

// Get mob threat info
export function getMobThreatInfo(entity: Entity) {
  if (!entity || !entity.name) return null;
  const mobName = entity.name.toLowerCase();
  return hostileMobsInfo[mobName as keyof typeof hostileMobsInfo] || null;
}

// Neutral mobs that hurt the bot lately (id -> until when): those it fights back
const provoked = new Map<number, number>();
const PROVOKED_MS = 15_000;
let watchingHurts = false;

/** Remembers the neutral mobs right by the bot when it gets hurt: they're the ones attacking. */
function watchHurts(): void {
  if (watchingHurts) return;
  watchingHurts = true;
  on("bot:damaged", () => {
    if (!bot.entity) return;
    const now = Date.now();
    for (const e of Object.values(bot.entities)) {
      if (e.name && NEUTRAL_MOBS.has(e.name) && e.position.distanceTo(bot.entity.position) < 4.5) provoked.set(e.id, now + PROVOKED_MS);
    }
  });
}

/**
 * A neutral mob is a target only when it attacked the bot (a piglin it trades
 * with, a zombified piglin it walks past, an enderman: never first; architect
 * review, the reflex started wars in the Nether). Pure over its inputs.
 */
export function mayAttackFirst(name: string, night: boolean, provokedNow: boolean, strong = true): boolean {
  // An enderman (40 health, hits for 7) only when it's strong enough to win
  // (game test: at 11 health with a stone sword it fought one and died)
  if (name === "enderman" && !strong) return false;
  return provokedNow || !isNeutralNow(name, night);
}

/** Strong enough for an enderman: most of its health and an iron sword or better (tier 3). Pure. */
export function strongEnough(health: number, swordTier: number): boolean {
  return health >= 16 && swordTier >= 3;
}

/** The live check. */
function strongNow(): boolean {
  const c = catalog();
  const sword = Math.max(-1, ...bot.inventory.items().filter((i) => c.toolKind(i.name) === "sword").map((i) => c.toolTier(i.name)));
  return strongEnough(bot.health ?? 0, sword);
}

// Get entities sorted by priority (threat level and distance)
export function getPriorityTargets(range = 16): Entity[] {
  watchHurts();
  const night = mobsOut();
  const now = Date.now();
  const hostileEntities = Object.values(bot.entities).filter(
    (entity) =>
      // creepers are handled by the creeper reflex: rushing them in melee with
      // pvp is exactly how the bot got blown up
      entity.name !== "creeper" &&
      entity.position.distanceTo(bot.entity.position) <= range &&
      isHostile(entity) &&
      mayAttackFirst(entity.name ?? "", night, (provoked.get(entity.id) ?? 0) > now, strongNow())
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
export async function attackEntity(targetEntity: Entity, announce = true): Promise<boolean> {
  try {
    // Choose appropriate weapon based on enemy type
    await chooseWeaponForTarget(targetEntity);
    
    // Choose appropriate tactics
    await useTacticsForTarget(targetEntity);
    
    // A fight is a hurry: it sprints after the target (ordinary errands walk)
    setHurry(bot, "fight", true);
    // (mineflayer-pvp's event, not in mineflayer's event types)
    (bot as unknown as { once: (event: string, fn: () => void) => void }).once("stoppedAttacking", () => setHurry(bot, "fight", false));
    // (and never for long, should the event not come)
    setTimeout(() => setHurry(bot, "fight", false), 60_000);
    // Attack
    await fighting.attack(targetEntity);
    if (announce) chatter(`Attacking ${targetEntity.name}!`, "combat");
    return true;
  } catch (error) {
    console.error("Error while attacking entity:", error);
    return false;
  }
}

// Choose the best weapon for a specific target
export async function chooseWeaponForTarget(target: Entity): Promise<boolean> {
  try {
    const threatInfo = getMobThreatInfo(target);
    if (!threatInfo) return await equipBestMeleeWeapon(); // Default if no specific info
    
    const preferredWeapon = threatInfo.preferredWeapon;
    
    // Try to equip preferred weapon type first
    if (preferredWeapon === "bow") {
      // Try to equip bow
      const bows = bot.inventory.items().filter(item => item.name === "bow"); // includes("bow") matched bowls
      
      if (bows.length > 0) {
        await equipItem(bows[0].name, "hand");
        // Check if we have arrows
        const arrows = bot.inventory.items().filter(item => catalog().isArrow(item.name));
        
        if (arrows.length > 0) {
          chatter(`Equipped ${bows[0].displayName} for ranged combat.`, "weapon");
          return true;
        }
      }
      
      // If no bow or arrows, try crossbow
      const crossbows = bot.inventory.items().filter(item => item.name === "crossbow");
      
      if (crossbows.length > 0 && bot.inventory.items().some(item => catalog().isArrow(item.name))) {
        await equipItem(crossbows[0].name, "hand");
        chatter(`Equipped ${crossbows[0].displayName} for ranged combat.`, "weapon");
        return true;
      }
    } 
    else if (preferredWeapon === "shield") {
      // Try to equip shield in offhand and best melee weapon in main hand
      const shields = bot.inventory.items().filter(item => item.name === "shield");
      if (shields.length > 0) {
        await equipItem(shields[0].name, "off-hand");
        chatter(`Equipped shield for defense.`, "weapon");
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

/**
 * The hardest-hitting sword or axe among `items`; with `orTools`, a pickaxe or
 * shovel when there's no weapon. Null when there's nothing (fists).
 */
export function bestMeleeWeapon(items: Item[], orTools = false): Item | null {
  const c = catalog();
  let weapons = items.filter((i) => c.isMeleeWeapon(i.name));
  if (weapons.length === 0 && orTools) weapons = items.filter((i) => ["pickaxe", "shovel"].includes(c.toolKind(i.name) ?? ""));
  return weapons.sort((a, b) => getAttackDamage(b) - getAttackDamage(a))[0] ?? null;
}

// Equip best melee weapon
export async function equipBestMeleeWeapon(): Promise<boolean> {
  try {
    const best = bestMeleeWeapon(bot.inventory.items(), true);
    if (!best) {
      chatter("No weapon available to equip.", "weapon");
      return false;
    }
    const weapons = [best];
    const bestWeapon = weapons[0];
    await equipItem(bestWeapon.name, "hand");
    chatter(`Equipped ${bestWeapon.displayName} for combat.`, "weapon");
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
  pathing.setGoal(null);
  
  try {
    // Use appropriate movement pattern based on mob type
    if (targetName === "creeper") {
      // For creepers: maintain distance, never get too close
      await maintainDistance(target, Math.max(preferredDistance, 4));
      chatter("Keeping distance from creeper!", "creeper");
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
      void lookAt(target.position);
    }
    else {
      // For other mobs: approach to attack or maintain optimal distance for ranged
      const equipment = bot.inventory.slots[bot.getEquipmentDestSlot('hand')];
      const isRanged = equipment && (equipment.name === "bow" || equipment.name === "crossbow");
      
      if (isRanged) {
        await maintainDistance(target, preferredDistance);
      } else {
        // For melee, get close but use optimal fighting position
        pathing.setMovements(walkingRules(bot));
        pathing.setGoal(new goals.GoalFollow(target, 2), true);
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
    
    pathing.setMovements(walkingRules(bot));
    pathing.setGoal(new goals.GoalBlock(
      targetPosition.x, 
      targetPosition.y, 
      targetPosition.z
    ), true);
  } else {
    // Too far, get closer
    pathing.setMovements(walkingRules(bot));
    pathing.setGoal(new goals.GoalFollow(target, distance), true);
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
  
  pathing.setMovements(walkingRules(bot));
  pathing.setGoal(new goals.GoalBlock(
    targetPosition.x, 
    targetPosition.y, 
    targetPosition.z
  ), true);
}

// Function to use shield for blocking
async function useShield(): Promise<boolean> {
  try {
    // Check if we have a shield in inventory
    const shields = bot.inventory.items().filter(item => item.name === "shield");
    
    if (shields.length > 0) {
      // Equip shield in off-hand if not already equipped
      const currentOffhand = bot.inventory.slots[bot.getEquipmentDestSlot('off-hand')];
      if (!currentOffhand || currentOffhand.name !== "shield") {
        await equipItem(shields[0].name, "off-hand");
      }
      
      // Activate shield (right click)
      useHeldItem(true); // true for offhand
      await __actionsDelay(500); // Block for a moment
      
      // Stop blocking
      stopUsingItem();
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error using shield:", error);
    return false;
  }
}
