import { z } from "zod";
import {
  CommandSchema,
  DbSchema,
  InventoryItemSchema,
  LocationsSchema,
  MineSchema,
  PositionSchema,
} from "./mainSchemas";

// Define the database schema type
export type DbSchemaType = z.infer<typeof DbSchema>;
export type CommandType = z.infer<typeof CommandSchema>;
export type InventoryItemType = z.infer<typeof InventoryItemSchema>;
export type PositionType = z.infer<typeof PositionSchema>;
export type LocationsType = z.infer<typeof LocationsSchema>;
export type MineType = z.infer<typeof MineSchema>;
