import { z } from "zod";
import { BotCommands } from "../commands/types";

// Define command validation schema
export const CommandSchema = z.object({
  id: z.string(),
  command: z.nativeEnum(BotCommands),
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

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const LocationsSchema = z.array(PositionSchema);

export const MineSchema = z.object({
  name: z.string(),
  direction: z.enum(["north", "south", "east", "west"]),
  startsAt: PositionSchema,
  endsAt: PositionSchema,
  depth: z.number().min(0),
});

export const DbSchema = z.object({
  commands: z.array(CommandSchema),
  lore: LoreSchema.optional(),
  inventory: InventorySchema.optional(),
  baseLocation: z
    .object({
      location: PositionSchema,
      craftTable: PositionSchema.optional(),
      furnace: PositionSchema.optional(),
      chests: LocationsSchema.optional(),
      mines: z.array(MineSchema).optional(),
    })
    .optional(),
});
