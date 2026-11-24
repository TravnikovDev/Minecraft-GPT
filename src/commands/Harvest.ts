// Path: src/commands/Harvest.ts

import { z } from "zod";
import { bot } from "../core/body";
import { findRipeCrops, harvestCrops } from "../actions/farming";

export const description = `Harvests ripe crops on farms nearby (wheat, carrots, potatoes, beetroots, melons,
pumpkins, sweet berries), picks up the drops and plants the seeds back so the farm keeps growing.
Example: "Harvest the farm", "Harvest the wheat", "Collect the carrots", "Pick the potatoes".`;

export const parameters = z.object({
  cropType: z
    .string()
    .nullable()
    .describe("Block ID of the crop to harvest (wheat, carrots, potatoes, beetroots, melon, pumpkin, sweet_berry_bush); null for all."),
});

export async function execute(args: any): Promise<void> {
  const parsed = parameters.safeParse(args);
  const only = parsed.success && parsed.data.cropType ? [parsed.data.cropType] : null;
  if (findRipeCrops(24, only).length === 0) {
    bot.chat("There's nothing ripe to harvest nearby.");
    return;
  }
  const harvested = await harvestCrops({ only });
  bot.chat(harvested > 0 ? `Harvested ${harvested} crops and replanted them.` : "I couldn't harvest anything.");
}
