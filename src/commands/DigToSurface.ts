// Path: src/commands/DigToSurface.ts
// Dig out to the surface: the reverse of digging a diagonal tunnel down. The
// bot digs a diagonal tunnel going up (one forward, one up per step) until
// the sky is open above it. Used when it's stuck underground or the owner
// says "get out", "go up", "dig out".

import { z } from "zod";
import { bot } from "../core/body";
import { digOutToSurface, seesSky } from "../actions/digging";
import { ensurePickaxe } from "../actions/ensureTools";

export const description = `The bot digs a diagonal tunnel up to the surface (the reverse of digging a diagonal tunnel
down), one block forward and one block up per step, until it sees the sky. Use when the bot is underground and the owner
wants it out. Example: "Dig out", "Get out of the cave", "Go up to the surface", "Escape to the surface".`;

export const parameters = z.object({
  maxRise: z.number().nullable().describe("The most blocks to go up (default 120)."),
});

export async function execute(args: any): Promise<void> {
  console.log(`Executing DigToSurface with args:`, args);
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for DigToSurface.`);
    return;
  }
  if (seesSky(bot.entity.position.floored())) {
    bot.chat("I'm already outside.");
    return;
  }
  await ensurePickaxe();
  bot.chat("Digging up to the surface.");
  const out = await digOutToSurface(parsed.data.maxRise ?? 120);
  bot.chat(out ? "I'm out on the surface." : "I couldn't dig my way out from here.");
}
