import { z } from "zod";
import { BotCommands } from "../commands/types";

// Define command validation schema
export const CommandSchema = z.object({
  id: z.string(),
  command: z.nativeEnum(BotCommands),
  priority: z.number().default(5),
  args: z.any().optional(),
  retryCount: z.number().default(3),
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

export const BotProgressSchema = z.object({
  currentLevel: z.number().min(1),
  craftableTier: z.number().min(1),
  unlockedRecipes: z.array(z.string())
});

// Session memory that survives bot restarts
export const MemorySchema = z.object({
  lastDeath: z
    .object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
      dimension: z.string(),
      at: z.number(),
      itemCount: z.number(),
    })
    .optional(),
  ownerPosition: z.object({ x: z.number(), y: z.number(), z: z.number(), at: z.number() }).optional(),
  bed: z.object({ x: z.number(), y: z.number(), z: z.number(), dimension: z.string(), at: z.number() }).optional(),
  // Chests the bot knows: where, and what was inside when it last looked
  chests: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
        dimension: z.string(),
        contents: z.record(z.string(), z.number()),
        seenAt: z.number(),
      })
    )
    .optional(),
  conversation: z
    .array(z.object({ role: z.enum(["owner", "bot"]), text: z.string(), at: z.number() }))
    .optional(),
});

export const DbSchema = z.object({
  commands: z.array(CommandSchema),
  memory: MemorySchema.optional(),
  lore: LoreSchema.optional(),
  inventory: InventorySchema.optional(),
  botProgress: BotProgressSchema.optional(),
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
