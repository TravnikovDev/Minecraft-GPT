// Path: src/managers/combatManager.ts

import { bot } from "../index";
import { plugin as pvp } from "mineflayer-pvp";
import { Entity } from "prismarine-entity";
import { Item } from "prismarine-item";
import { z } from "zod";

// Load PVP plugin
bot.loadPlugin(pvp);

// Define combat parameters schema
const combatParametersSchema = z.object({
  entityType: z.string().describe("The type of entity to attack."),
  range: z
    .number()
    .optional()
    .default(16)
    .describe("Range within which to find the entity."),
});

function getAttackDamage(item: Item): number {
  // Define attack damage values for different weapons
  const attackDamageMap: { [key: string]: number } = {
    wooden_sword: 4,
    stone_sword: 5,
    iron_sword: 6,
    diamond_sword: 7,
    netherite_sword: 8,
    wooden_axe: 3,
    stone_axe: 4,
    iron_axe: 5,
    diamond_axe: 6,
    netherite_axe: 7,
    wooden_pickaxe: 2,
    stone_pickaxe: 3,
    iron_pickaxe: 4,
    diamond_pickaxe: 5,
    netherite_pickaxe: 6,
    wooden_shovel: 1,
    stone_shovel: 2,
    iron_shovel: 3,
    netherite_shovel: 5,
  };
  return attackDamageMap[item.name] || 0;
}

// Attack a Specific Entity by Type
export async function attackEntity(
  entityType: string,
  range = 16
): Promise<boolean> {
  try {
    const targetEntity = bot.nearestEntity(
      (entity) =>
        entity.name === entityType &&
        entity.type === "mob" &&
        entity.position.distanceTo(bot.entity.position) <= range
    );
    if (targetEntity) {
      bot.pvp.attack(targetEntity);
      bot.chat(`Attacking ${entityType}!`);
      return true;
    } else {
      bot.chat(`No ${entityType} found within range ${range}.`);
      return false;
    }
  } catch (error) {
    console.error("Error while attacking entity:", error);
    return false;
  }
}

// Defend Against Nearby Hostiles
export async function defendSelf(range = 16): Promise<boolean> {
  try {
    const hostileEntity = bot.nearestEntity(
      (entity) =>
        entity.type === "mob" &&
        entity.position.distanceTo(bot.entity.position) <= range &&
        isHostile(entity)
    );
    if (hostileEntity) {
      bot.pvp.attack(hostileEntity);
      bot.chat(`Defending myself against ${hostileEntity.name}!`);
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

// Check if an Entity is Hostile
function isHostile(entity: Entity): boolean {
  // Define basic hostile mobs
  const hostileMobs = [
    "zombie",
    "skeleton",
    "spider",
    "creeper",
    "witch",
    "enderman",
    "pillager",
  ];
  return hostileMobs.includes(entity.name);
}

// Stop Combat
export async function stopCombat(): Promise<void> {
  try {
    bot.pvp.stop();
    bot.chat("Stopping combat.");
  } catch (error) {
    console.error("Error while stopping combat:", error);
  }
}

// Equip Best Weapon for Combat
export async function equipBestWeapon(): Promise<boolean> {
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
