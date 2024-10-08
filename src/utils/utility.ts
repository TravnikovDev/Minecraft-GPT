// Path: src/utils/utility.ts

import { bot } from "../index";

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
