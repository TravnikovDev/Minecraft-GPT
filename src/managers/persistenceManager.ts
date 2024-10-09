// Path: src/managers/persistenceManager.ts

import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { resolve } from "path";
import { z } from "zod";

// Define Zod schemas for database validation
const ActionSchema = z.object({
  id: z.string(),
  action: z.string(),
  args: z.any(),

  priority: z.number(),
});

const LoreSchema = z.object({
  events: z.array(z.string()),
});

const InventoryItemSchema = z.object({
  name: z.string(),
  count: z.number().min(0),
});

const InventorySchema = z.array(InventoryItemSchema);

const DbSchema = z.object({
  actions: z.array(ActionSchema),
  lore: LoreSchema.optional(),
  inventory: InventorySchema.optional(),
});

// Define the database schema type
type DbSchemaType = z.infer<typeof DbSchema>;

// Database Setup
const dbPath = resolve("db.json");
const adapter = new JSONFile<DbSchemaType>(dbPath);
const db = new Low<DbSchemaType>(adapter, {
  actions: [],
  lore: { events: [] },
  inventory: [],
});

// Load Database
export async function loadDb() {
  try {
    await db.read();
    db.data ||= { actions: [], lore: { events: [] }, inventory: [] };
    const parsedData = DbSchema.safeParse(db.data);
    if (!parsedData.success) {
      throw new Error("Database validation failed");
    }
    db.data = parsedData.data;
    await db.write();
  } catch (error) {
    console.error("Error loading database:", error);
  }
}

// Save Data to Database
export async function saveDb() {
  try {
    const parsedData = DbSchema.safeParse(db.data);
    if (!parsedData.success) {
      throw new Error("Database validation failed");
    }
    await db.write();
  } catch (error) {
    console.error("Error saving to database:", error);
  }
}

// Add Action to Database
export async function addAction(
  id: string,
  action: string,
  args: any,
  priority: number
) {
  try {
    const newAction = { id, action, args, priority };
    const parsedAction = ActionSchema.safeParse(newAction);
    if (!parsedAction.success) {
      throw new Error("Action validation failed");
    }
    db.data?.actions.push(parsedAction.data);
    await saveDb();
  } catch (error) {
    console.error("Error adding action to database:", error);
  }
}

// Remove Action from Database
export async function removeAction(id: string) {
  try {
    if (db.data) {
      db.data.actions = db.data.actions.filter((action) => action.id !== id);
      await saveDb();
    }
  } catch (error) {
    console.error("Error removing action from database:", error);
  }
}

// Get All Actions from Database
export function getAllActions() {
  return db.data?.actions || [];
}

// Add Lore Event to Database
export async function addLoreEvent(event: string) {
  try {
    const parsedEvent = z.string().safeParse(event);
    if (!parsedEvent.success) {
      throw new Error("Lore event validation failed");
    }
    db.data?.lore?.events.push(parsedEvent.data);
    await saveDb();
  } catch (error) {
    console.error("Error adding lore event to database:", error);
  }
}

// Get All Lore Events from Database
export function getAllLoreEvents() {
  return db.data?.lore?.events || [];
}

// Sync Inventory with Database
export async function syncInventory(
  inventory: { name: string; count: number }[]
) {
  try {
    const parsedInventory = InventorySchema.safeParse(inventory);
    if (!parsedInventory.success) {
      throw new Error("Inventory validation failed");
    }
    if (db.data) {
      db.data.inventory = parsedInventory.data;
      await saveDb();
    }
  } catch (error) {
    console.error("Error syncing inventory to database:", error);
  }
}

// Get Inventory
export function getInventory() {
  return db.data?.inventory || [];
}
