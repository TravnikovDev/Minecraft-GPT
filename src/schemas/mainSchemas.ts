import { z } from "zod";
import { BotCommands } from "../commands/types";

// Define command validation schema
export const CommandSchema = z.object({
  id: z.string(),
  command: z.nativeEnum(BotCommands),
  args: z.any(),
  priority: z.number().min(1).max(10),
  retryCount: z.number().optional(),
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

export const MineSchema = z.object({
  name: z.string(),
  direction: z.enum(["north", "south", "east", "west"]),
  startsAt: PositionSchema,
  endsAt: PositionSchema,
  depth: z.number().min(0),
});

export const ChestSchema = z.object({
  type: z.enum([
    "Tools",
    "RawResources",
    "RefinedMaterials",
    "Food",
    "Miscellaneous",
  ]),
  location: PositionSchema,
  items: InventorySchema,
});

export const DbSchema = z.object({
  commands: z.array(CommandSchema),
  lore: LoreSchema.optional(),
  inventory: InventorySchema.optional(),
  baseLocation: z
    .object({
      baseName: z.string(),
      location: PositionSchema,
      basementLocation: PositionSchema.optional(),
      craftTable: z.array(PositionSchema),
      furnace: z.array(PositionSchema),
      chests: z.array(ChestSchema),
      mines: z.array(MineSchema),
    })
    .optional(),
});
