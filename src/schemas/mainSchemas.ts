import { z } from "zod";
import { BotActions } from "../actions/types";
import { BotTasks } from "../tasks/types";

// Define action validation schema
export const ActionSchema = z.object({
  id: z.string(),
  action: z.nativeEnum(BotActions),
  args: z.any(),
  priority: z.number().min(1).max(10),
});

// Define Task Schema
export const TaskSchema = z.object({
  id: z.string().uuid(),
  name: z.nativeEnum(BotTasks),
  actions: z.array(ActionSchema),
  status: z.enum(["pending", "in_progress", "completed"]),
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
