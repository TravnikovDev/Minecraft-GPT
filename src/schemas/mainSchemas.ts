import { z } from "zod";
import { BotCommands } from "../commands/types";

// Define command validation schema
export const CommandSchema = z.object({
  id: z.string(),
  command: z.custom<BotCommands>((v) => typeof v === "string" && v.length > 0), // a name from commands/all.ts (checked when it runs)
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

/** A remembered point of interest (memory schema v2). */
export const PlaceSchema = z.object({
  kind: z.enum(["base", "basement", "crafting_table", "furnace", "mine", "farm"]),
  name: z.string().optional(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  dimension: z.string(),
  at: z.number(),
  // Kind-specific details (a mine's direction, depth and end)
  details: z.record(z.string(), z.unknown()).optional(),
});

/** An area the bot must not dig or build in. */
export const ForbiddenAreaSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  radius: z.number(),
  dimension: z.string(),
  reason: z.string(),
  source: z.enum(["owner", "server"]),
  until: z.number().optional(), // forgotten after this (server-detected areas)
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
  // (contents null: known chest, never opened; it never answers "no iron")
  chests: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
        dimension: z.string(),
        contents: z.record(z.string(), z.number()).nullable(),
        seenAt: z.number(),
      })
    )
    .optional(),
  conversation: z
    .array(z.object({ role: z.enum(["owner", "bot"]), text: z.string(), at: z.number() }))
    .optional(),
  // The last few deaths, kept for "where did you die?" (recovering items clears lastDeath, not this)
  deaths: z
    .array(z.object({ x: z.number(), y: z.number(), z: z.number(), dimension: z.string(), at: z.number() }))
    .optional(),
  // Milestones (Phase 6): when each was first reached
  milestones: z.record(z.string(), z.number()).optional(),
  // The bot lives its own life (goes for milestones, sleeps in its shelter) when on
  autonomy: z.object({ on: z.boolean(), since: z.number() }).optional(),
  // Points of interest (schema v2): the base, crafting tables, furnaces, mines, farms
  places: z.array(PlaceSchema).optional(),
  // Areas it must not dig or build in: marked by the owner, or protected by the server
  forbidden: z.array(ForbiddenAreaSchema).optional(),
  // Blocks it put down only to get somewhere (it takes them down again; kept across restarts)
  scaffolds: z.array(z.object({ x: z.number(), y: z.number(), z: z.number(), name: z.string().nullable() })).optional(),
  // Blocks its tunnels put into water or lava (dug through like stone, never taken down)
  plugs: z.array(z.object({ x: z.number(), y: z.number(), z: z.number() })).optional(),
}).passthrough(); // fields a newer version adds (a diary) survive an older one

// db.json, schema v2. Unknown fields are kept (passthrough), so an older or
// newer version of the bot never erases what it doesn't know about.
export const DbSchema = z
  .object({
    version: z.number().optional(),
    memory: MemorySchema.optional(),
    lore: LoreSchema.optional(),
    botProgress: BotProgressSchema.optional(),
  })
  .passthrough();
