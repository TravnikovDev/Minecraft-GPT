// Path: src/commands/PlaceItem.ts

import { z } from "zod";
import { bot } from "../core/body";
import { findPlaceableItem, placeItemNear } from "../actions/placement";

export const description = `Places an item from the bot's inventory on the ground nearby: a bed, crafting table,
chest, furnace, torch, or any block. Generic names are fine ("bed" places whichever bed it carries).
Example: "Place your bed", "Put down a crafting table", "Place a chest here", "Put a torch down".`;

export const parameters = z.object({
  itemName: z.string().describe("Minecraft ID of the item to place, or a generic name like bed or chest."),
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

  const placed = await placeItemNear(item);
  if (placed) {
    const p = placed.position;
    bot.chat(`Placed the ${pretty(item)} at ${p.x}, ${p.y}, ${p.z}.`);
  } else {
    bot.chat(`I couldn't find a free spot to place the ${pretty(item)}.`);
  }
}
