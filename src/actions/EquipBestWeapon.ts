// Path: src/actions/EquipBestWeapon.ts

import { z } from "zod";
import { BotActions } from "./types";
import { bot } from "../index";

// Define parameters for the EquipBestWeapon action
export const parameters = z.object({});

// Register the action with zodFunction for validation
export const EquipBestWeaponFunction = {
  name: BotActions.EquipBestWeapon,
  parameters: parameters,
};

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
