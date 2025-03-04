import { z } from "zod";
import {
  ChestSchema,
  CommandSchema,
  DbSchema,
  InventoryItemSchema,
  MineSchema,
  PositionSchema,
} from "./mainSchemas";

// Define the database schema type
export type DbSchemaType = z.infer<typeof DbSchema>;
export type CommandType = z.infer<typeof CommandSchema>;
export type InventoryItemType = z.infer<typeof InventoryItemSchema>;
export type PositionType = z.infer<typeof PositionSchema>;
export type MineType = z.infer<typeof MineSchema>;
export type ChestType = z.infer<typeof ChestSchema>;

export type BotProgressType = {
  currentLevel: number;
  craftableTier: number;
  unlockedRecipes: string[];
};

export type DbSchemaType = {
  commands: CommandType[];
  lore?: { events: string[] };
  inventory?: InventoryItemType[];
  botProgress?: BotProgressType;
  baseLocation?: {
    baseName: string;
    location: PositionType;
    basementLocation?: PositionType;
    craftTable: PositionType[];
    furnace: PositionType[];
    chests: ChestType[];
    mines: MineType[];
  };
};
