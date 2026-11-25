// Path: src/commands/TakeFromChest.ts
// Takes items out of a chest: the ones the owner names (from the chest that
// had them when the bot last looked), or everything in the nearest chest.

import { z } from "zod";
import { reply } from "../core/narrator";
import { describeContents, takeItems } from "../actions/storage";

export const description = `Takes items out of a chest (the remembered chest that has them, or the nearest one).
List the items with counts, or set items to null to take everything from the nearest chest.
Examples: "Take the iron from the chest", "Get 16 torches from the chest", "Grab your food from the chest",
"Take everything out of the chest" (items null).`;

export const parameters = z.object({
  items: z
    .array(
      z.object({
        name: z.string().describe("Minecraft ID or a category like planks, logs, food."),
        count: z.number().nullable().describe("How many; null for all of them."),
      })
    )
    .nullable()
    .describe("What to take; null to take everything."),
});

export async function execute(args: any): Promise<void> {
  console.log(`Executing TakeFromChest with args:`, args);
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for TakeFromChest.`, parsed.error);
    return;
  }
  const result = await takeItems(parsed.data.items);
  if (!result) {
    reply("I don't know any chest around here.");
    return;
  }
  const { taken, missing, full, chestAt, problem } = result;
  if (problem && taken.size === 0) {
    reply(`I couldn't use the chest at ${chestAt}: ${problem}.`);
    return;
  }
  const parts: string[] = [];
  if (taken.size > 0) parts.push(`Took ${describeContents(taken)} from the chest at ${chestAt}.`);
  if (missing.length > 0) parts.push(`There's no ${missing.join(" or ")} in it.`);
  if (full) parts.push("My inventory is full now.");
  reply(parts.join(" ") || "The chest is empty.");
}
