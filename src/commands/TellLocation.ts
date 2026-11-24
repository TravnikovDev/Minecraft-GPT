import { z } from "zod";
import { getBotPosition } from "../actions/movement";
import { bot } from "../index.js";
import { directionFromOwner, ownerDistance } from "../managers/ownerDialog";

export const description = `Reports the bot's current position (x, y, z coordinates).
Expected usage: "Where are you?", "How far are you?", "Tell me your location", "What's your current position?"
Answers immediately, even while the bot is busy.`;

// No parameters needed for this command
export const parameters = z.object({});

export async function execute(): Promise<void> {
  console.log(`Executing TellLocation command`);
  
  const position = getBotPosition();
  const distance = ownerDistance();
  const relation =
    distance === null
      ? " I can't see you from here."
      : distance < 4
        ? " Right next to you."
        : ` That's about ${Math.round(distance)} blocks ${directionFromOwner()} of you.`;
  const message = `I'm at ${Math.floor(position.x)}, ${Math.floor(position.y)}, ${Math.floor(position.z)}.${relation}`;
  
  // Log to console
  console.log(message);
  
  // Send to in-game chat if available
  try {
    bot.chat(message);
  } catch (error) {
    console.error("Failed to send position to chat:", error);
  }
}
