// Path: src/actions/EquipBestWeapon.ts

import { z } from "zod";
import { bot } from "../index";

export const description = `When user asks the bot to equip the best weapon, the bot will search for the best weapon 
in its inventory and equip it. Example: "Equip the best weapon.", "Prepare to fight."`;

// Define parameters for the EquipBestWeapon action
export const parameters = z.object({});

// Implement the EquipBestWeapon action
export async function execute(args: any) {
  console.log(`Executing EquipBestWeapon with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for EquipBestWeapon.`);
    return;
  }

  try {
    // Filter the weapons from inventory
    let weapons = bot.inventory
      .items()
      .filter(
        (item) =>
          item.name.includes("sword") ||
          (item.name.includes("axe") && !item.name.includes("pickaxe"))
      );

    // If no suitable weapons, filter for pickaxes or shovels
    if (weapons.length === 0) {
      weapons = bot.inventory
        .items()
        .filter(
          (item) =>
            item.name.includes("pickaxe") || item.name.includes("shovel")
        );
    }

    // If still no weapons, return
    if (weapons.length === 0) {
      console.log("No suitable weapon found in inventory.");
      return;
    }

    // Sort weapons by attack damage (descending order)
    // @ts-ignore
    weapons.sort((a, b) => a.attackDamage < b.attackDamage);

    // Equip the best weapon
    const bestWeapon = weapons[0];
    if (bestWeapon) {
      await bot.equip(bestWeapon, "hand");
      console.log(`Equipped the best weapon: ${bestWeapon.displayName}`);
    }
  } catch (error) {
    console.error("Failed to equip the best weapon:", error);
  }
}
