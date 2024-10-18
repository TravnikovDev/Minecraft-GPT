// Path: src/actions/Stop.ts

import { z } from "zod";
import { bot } from "../index";
import { removeAllCommands } from "../managers/persistenceManager";

export const description = `When user asks the bot to `;

// Define parameters for Stop action
export const parameters = z.object({});

// Implement the Stop action
export async function execute() {
  try {
    console.log(`====> Stop actions execution !`);
    await bot.pathfinder.stop();
    await removeAllCommands();
    bot.chat(`Standing still!`);
  } catch (error) {
    console.error("Error executing Stop action:", error);
    bot.chat(`I can't Stop!`);
  }
}
