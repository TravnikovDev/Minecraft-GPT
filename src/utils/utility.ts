// Path: src/utils/utility.ts

import { bot } from "../index";
import { Item } from "prismarine-item";

// Utility function to log messages to the console and optionally send them in chat
export function log(message: string, sendToChat = false): void {
  console.log(`[LOG]: ${message}`);
  if (sendToChat) {
    bot.chat(message);
  }
}

// Utility function to introduce a delay
export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Utility function to get a formatted timestamp
export function getTimestamp(): string {
  const now = new Date();
  return now.toISOString();
}

// Utility function to generate a random number between a specified range
export function getRandomInt(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Utility function to capitalize the first letter of a string
export function capitalizeFirstLetter(text: string): string {
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function getAttackDamage(item: Item): number {
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
