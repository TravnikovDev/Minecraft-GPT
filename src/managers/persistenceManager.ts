// Path: src/managers/persistenceManager.ts

import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { resolve } from "path";
import { z } from "zod";
import { ActionType, DbSchemaType } from "../schemas/types";
import {
  ActionSchema,
  DbSchema,
  InventorySchema,
} from "../schemas/mainSchemas";

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
export async function addAction(newAction: ActionType) {
  try {
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
