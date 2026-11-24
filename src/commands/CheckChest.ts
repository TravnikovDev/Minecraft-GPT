// Path: src/commands/CheckChest.ts
// Says what's in a chest, or where an item is stored, from what the bot saw
// in its chests (it looks again in the nearest one when it doesn't know).

import { z } from "zod";
import { bot } from "../core/body";
import { chooseChest, describeContents, lookInChest, whereStored } from "../actions/storage";
import { explain } from "../core/result";

export const description = `Tells what is in the nearest chest, or where an item is stored ("Where are my diamonds?").
Examples: "What's in the chest?", "Check the chest", "Where did you put the iron?", "Do we have any wool stored?".`;

export const parameters = z.object({
  itemName: z.string().nullable().describe("The item to find in the chests; null to list the nearest chest."),
});

export async function execute(args: any): Promise<void> {
  console.log(`Executing CheckChest with args:`, args);
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for CheckChest.`, parsed.error);
    return;
  }
  const item = parsed.data.itemName;
  if (item) {
    const found = whereStored(item);
    if (found.length > 0) {
      bot.chat(`${found.slice(0, 3).join("; ")}.`);
      return;
    }
  }
  const chest = await chooseChest();
  if (!chest) {
    bot.chat("I don't know any chest around here.");
    return;
  }
  let contents: Map<string, number>;
  try {
    contents = await lookInChest(chest);
  } catch (error) {
    bot.chat(`I couldn't look in the chest: ${explain(error)}.`);
    return;
  }
  const p = chest.position;
  if (item) {
    const again = whereStored(item);
    bot.chat(again.length > 0 ? `${again.slice(0, 3).join("; ")}.` : `There's no ${item.replace(/_/g, " ")} in the chests I know.`);
    return;
  }
  bot.chat(`The chest at ${p.x}, ${p.y}, ${p.z} has ${describeContents(contents)}.`);
}
