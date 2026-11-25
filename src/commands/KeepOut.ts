// Path: src/commands/KeepOut.ts
// The owner marks an area the bot must not dig or build in (core/forbidden),
// around where the owner stands (or the bot, if the owner isn't in sight).

import { z } from "zod";
import { reply } from "../core/narrator";
import { markForbidden } from "../core/forbidden";
import { bot } from "../core/body";
import { ownerEntity } from "../managers/ownerDialog";

export const description = `Marks an area the bot must never dig or build in, around where the owner stands
(e.g. the owner's house, a farm, a build). Default radius 16 blocks. Answers immediately.
Examples: "Keep out of here", "Don't dig around my house", "Don't touch this area, 30 blocks".`;

export const parameters = z.object({
  radius: z.number().nullable().describe("How far around, in blocks (default 16)."),
});

export async function execute(args: unknown): Promise<void> {
  const parsed = parameters.safeParse(args);
  const radius = Math.max(2, Math.min(64, (parsed.success ? parsed.data.radius : null) ?? 16));
  const center = ownerEntity()?.position ?? bot.entity.position;
  await markForbidden(center, radius, "the owner asked me to keep out", "owner");
  reply(`Okay, I won't dig or build within ${radius} blocks of ${Math.floor(center.x)}, ${Math.floor(center.y)}, ${Math.floor(center.z)}.`);
}
