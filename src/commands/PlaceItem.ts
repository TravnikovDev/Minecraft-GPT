// Path: src/commands/PlaceItem.ts

import { z } from "zod";
import { bot } from "../core/body";
import { findPlaceableItem, placeItemNear, placeItemNextTo } from "../actions/placement";

export const description = `Places an item from the bot's inventory: a bed, crafting table, chest, furnace, torch,
or any block. Generic names are fine ("bed" places whichever bed it carries). With near, it goes right next to that
thing: "owner" (next to the owner, also for "here"), or a block like bed, chest, crafting_table, furnace, door.
Examples: "Place your bed" (near null), "Put the chest near the bed" (near bed), "Place a chest here" (near owner),
"Put a crafting table next to the chest" (near chest).`;

export const parameters = z.object({
  itemName: z.string().describe("Minecraft ID of the item to place, or a generic name like bed or chest."),
  near: z
    .string()
    .nullable()
    .describe('Place it next to this: "owner", or a block like bed, chest, crafting_table. Null: wherever the bot is.'),
});

const pretty = (name: string): string => name.replace(/_/g, " ");

export async function execute(args: any): Promise<void> {
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for PlaceItem.`);
    return;
  }

  const item = findPlaceableItem(parsed.data.itemName);
  if (!item) {
    bot.chat(`I don't have a ${pretty(parsed.data.itemName)} to place.`);
    return;
  }

  const near = parsed.data.near?.trim();
  if (near) {
    const result = await placeItemNextTo(item, near);
    if (typeof result === "string") {
      bot.chat(result);
    } else {
      const p = result.position;
      const where = ["owner", "me", "here", "you", "player"].includes(near.toLowerCase()) ? "you" : `the ${pretty(near)}`;
      bot.chat(`Placed the ${pretty(item)} next to ${where} at ${p.x}, ${p.y}, ${p.z}.`);
    }
    return;
  }

  const placed = await placeItemNear(item);
  if (placed) {
    const p = placed.position;
    bot.chat(`Placed the ${pretty(item)} at ${p.x}, ${p.y}, ${p.z}.`);
  } else {
    bot.chat(`I couldn't find a free spot to place the ${pretty(item)}.`);
  }
}
