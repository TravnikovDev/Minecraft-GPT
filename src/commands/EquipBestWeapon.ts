// Path: src/commands/EquipBestWeapon.ts

import { z } from "zod";
import { catalog } from "../core/catalog";
import { bot } from "../core/body";
import { equipBestMeleeWeapon, chooseWeaponForTarget } from "../actions/combat";
import { getPriorityTargets } from "../actions/combat";

export const description = `When user asks the bot to equip the best weapon, the bot will equip the most appropriate weapon 
based on nearby threats or weapon type specified. Examples: "Equip the best weapon", "Prepare for combat", 
"Get your bow ready", "Equip shield for defense", "Use sword and shield"`;

// Define parameters for the EquipBestWeapon action
export const parameters = z.object({
  weaponType: z
    .string()
    .nullable()
    .describe("Specific type of weapon to equip (sword, axe, bow, shield)"),
  offhand: z
    .boolean()
    .nullable()
    .describe("Whether to also equip a shield in the off-hand when appropriate"),
});

// Implement the EquipBestWeapon action
export async function execute(args: any) {
  console.log(`Executing EquipBestWeapon with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for EquipBestWeapon.`);
    return;
  }

  const { weaponType } = parsed.data;
  const offhand = parsed.data.offhand ?? true;

  try {
    // If a specific weapon type is requested
    if (weaponType) {
      if (weaponType.includes("bow")) {
        // Try to equip bow
        const bows = bot.inventory.items().filter(item => item.name === "bow");
        
        if (bows.length > 0) {
          await bot.equip(bows[0], "hand");
          bot.chat(`Equipped ${bows[0].displayName} for ranged combat.`);
          
          // Check if we have arrows
          const arrows = bot.inventory.items().filter(item => catalog().isArrow(item.name));
          
          if (arrows.length === 0) {
            bot.chat("Warning: No arrows found in inventory!");
          }
          
        } else {
          // Try crossbow as fallback
          const crossbows = bot.inventory.items().filter(item => item.name === "crossbow");
          
          if (crossbows.length > 0) {
            await bot.equip(crossbows[0], "hand");
            bot.chat(`Equipped ${crossbows[0].displayName} for ranged combat.`);
            
            // Check if we have arrows
            const arrows = bot.inventory.items().filter(item => catalog().isArrow(item.name));
            
            if (arrows.length === 0) {
              bot.chat("Warning: No arrows found in inventory!");
            }
          } else {
            bot.chat("No bow or crossbow found in inventory. Equipping best melee weapon instead.");
            await equipBestMeleeWeapon();
          }
        }
      } 
      else if (weaponType.includes("sword")) {
        // Try to equip sword
        const swords = bot.inventory.items().filter(item => catalog().toolKind(item.name) === "sword");
        
        if (swords.length > 0) {
          // Sort by quality
          swords.sort((a, b) => catalog().toolTier(b.name) - catalog().toolTier(a.name));
          
          await bot.equip(swords[0], "hand");
          bot.chat(`Equipped ${swords[0].displayName} for combat.`);
          
          // Equip shield in offhand if available and requested
          if (offhand) {
            const shields = bot.inventory.items().filter(item => item.name === "shield");
            
            if (shields.length > 0) {
              await bot.equip(shields[0], "off-hand");
              bot.chat(`Also equipped shield in off-hand for defense.`);
            }
          }
        } else {
          bot.chat("No sword found in inventory. Equipping best melee weapon instead.");
          await equipBestMeleeWeapon();
        }
      }
      else if (weaponType.includes("shield")) {
        // Try to equip shield in offhand and best weapon in main hand
        const shields = bot.inventory.items().filter(item => item.name === "shield");
        
        if (shields.length > 0) {
          await bot.equip(shields[0], "off-hand");
          bot.chat(`Equipped shield in off-hand for defense.`);
          
          // Equip best melee weapon in main hand
          await equipBestMeleeWeapon();
        } else {
          bot.chat("No shield found in inventory. Equipping best melee weapon only.");
          await equipBestMeleeWeapon();
        }
      }
      else {
        // Default to best melee weapon
        await equipBestMeleeWeapon();
      }
    } 
    else {
      // No specific type requested, check for nearby enemies to make smart choice
      const nearbyHostiles = getPriorityTargets(16);
      
      if (nearbyHostiles.length > 0) {
        // Choose weapon based on nearest threat
        const nearestThreat = nearbyHostiles[0];
        bot.chat(`Choosing best weapon to fight ${nearestThreat.name}.`);
        await chooseWeaponForTarget(nearestThreat);
      } else {
        // No threats nearby, just equip best melee weapon
        bot.chat("No specific threats detected. Equipping best general-purpose weapon.");
        await equipBestMeleeWeapon();
      }
    }
  } catch (error) {
    console.error("Failed to equip the weapon:", error);
    bot.chat("Failed to equip the requested weapon.");
  }
}
