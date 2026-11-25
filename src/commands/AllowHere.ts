// Path: src/commands/AllowHere.ts
// The owner lifts a keep-out area (core/forbidden) where they stand.

import { z } from "zod";
import { reply } from "../core/narrator";
import { clearForbiddenAt, forbiddenAreas } from "../core/forbidden";
import { bot } from "../core/body";
import { ownerEntity } from "../managers/ownerDialog";

export const description = `Lifts the keep-out areas covering where the owner stands, so the bot may dig and build there
again (including areas the bot decided were protected by the server). Answers immediately.
Examples: "You can work here again", "It's okay to dig here", "Forget the keep-out area".`;

export const parameters = z.object({});

export async function execute(): Promise<void> {
  const here = ownerEntity()?.position ?? bot.entity.position;
  const cleared = await clearForbiddenAt(here);
  if (cleared > 0) reply(`Okay, I can dig and build here again.`);
  else reply(forbiddenAreas().length > 0 ? "There's no keep-out area right here." : "I'm not keeping out of anywhere.");
}
