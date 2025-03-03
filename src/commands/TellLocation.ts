import { z } from "zod";
import { getBotPosition } from "../actions/movement";
import { bot } from "../index.js";

export const description = `Reports the bot's current position (x, y, z coordinates).
Expected usage: "Where are you?" or "Tell me your location" or "What's your current position?"`;

// No parameters needed for this command
export const parameters = z.object({});

export async function execute(): Promise<void> {
  console.log(`Executing TellLocation command`);
  
  const position = getBotPosition();
  const message = `I am currently at x=${position.x}, y=${position.y}, z=${position.z}`;
  
  // Log to console
  console.log(message);
  
  // Send to in-game chat if available
  try {
    bot.chat(message);
  } catch (error) {
    console.error("Failed to send position to chat:", error);
  }
}
