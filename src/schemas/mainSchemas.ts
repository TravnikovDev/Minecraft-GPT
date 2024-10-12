import { z } from "zod";
import { BotCommands } from "../commands/types";

// Define action validation schema
export const ActionSchema = z.object({
  id: z.string(),
  action: z.nativeEnum(BotCommands),
  args: z.any(),
  priority: z.number().min(1).max(10),
});

export const LoreSchema = z.object({
  events: z.array(z.string()),
});

export const InventoryItemSchema = z.object({
  name: z.string(),
  count: z.number().min(0),
});

export const InventorySchema = z.array(InventoryItemSchema);

export const DbSchema = z.object({
  actions: z.array(ActionSchema),
  lore: LoreSchema.optional(),
  inventory: InventorySchema.optional(),
});
