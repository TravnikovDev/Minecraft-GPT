// Path: src/commands/FindAndRememberNearChest.ts
// "Remember this chest": looks into the chests and barrels around and keeps
// where they are and what's inside (saved, so it survives restarts). Storing,
// taking and "where is my X" use this memory.

import { z } from "zod";
import { bot } from "../core/body";
import { STORAGE_BLOCKS } from "../core/containers";
import { describeContents, lookInChest } from "../actions/storage";

export const description = `When the owner asks the bot to find and remember chests nearby ("remember this chest",
"remember those chests"), the bot looks into the chests and barrels within the radius and remembers where they are and
what's inside, for storing and taking items later. Default radius 10.`;

export const parameters = z.object({
  radius: z.number().nullable().describe("Radius to search for chests (default 10)."),
});

const MAX_CHESTS = 8;

export async function execute(args: any): Promise<void> {
  console.log(`Executing FindAndRememberNearChest with args:`, args);
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for FindAndRememberNearChest:`, parsed.error);
    return;
  }
  const radius = parsed.data.radius ?? 10;
  const ids = [...STORAGE_BLOCKS].map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  const positions = bot.findBlocks({ matching: ids, maxDistance: radius, count: MAX_CHESTS * 2 });

  // A double chest is two blocks; look in it once
  const seen: { x: number; y: number; z: number }[] = [];
  let remembered = 0;
  for (const pos of positions) {
    if (remembered >= MAX_CHESTS) break;
    if (seen.some((s) => s.y === pos.y && Math.abs(s.x - pos.x) + Math.abs(s.z - pos.z) === 1)) continue;
    const block = bot.blockAt(pos);
    if (!block) continue;
    try {
      const contents = await lookInChest(block);
      seen.push(pos);
      remembered++;
      bot.chat(`I'll remember the ${block.name.replace(/_/g, " ")} at ${pos.x}, ${pos.y}, ${pos.z}: ${describeContents(contents, 5)}.`);
    } catch (error) {
      console.log(`Couldn't look into the ${block.name} at ${pos}: ${(error as Error).message}`);
    }
  }
  if (remembered === 0) bot.chat(`I don't see any chest within ${radius} blocks.`);
}
