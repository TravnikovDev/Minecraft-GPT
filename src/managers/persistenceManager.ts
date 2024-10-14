// Path: src/managers/persistenceManager.ts

import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { resolve } from "path";
import { z } from "zod";
import type {
  CommandType,
  DbSchemaType,
  InventoryItemType,
} from "../schemas/types";
import {
  CommandSchema,
  DbSchema,
  InventorySchema,
} from "../schemas/mainSchemas";

// Database Setup
const dbPath = resolve("db.json");
const adapter = new JSONFile<DbSchemaType>(dbPath);
const db = new Low<DbSchemaType>(adapter, {
  commands: [],
  lore: { events: [] },
  inventory: [],
});

// Load Database
export async function loadDb() {
  try {
    await db.read();
    const parsedData = DbSchema.safeParse(db.data);
    if (!parsedData.success) {
      throw new Error("Database validation failed", parsedData.error);
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
      throw new Error("Database validation failed", parsedData.error);
    }
    await db.write();
  } catch (error) {
    console.error("Error saving to database:", error);
  }
}

// Add Command to Database
export async function addCommandToQueue(newCommand: CommandType) {
  try {
    console.log("Adding command to queue:", newCommand.command);
    const parsedCommand = CommandSchema.safeParse(newCommand);
    if (!parsedCommand.success) {
      throw new Error("Command validation failed: " + parsedCommand.error);
    } else {
      console.log(
        `- Adding command ${parsedCommand.data.command} with priority ${parsedCommand.data.priority} to queue.`
      );
    }
    db.data?.commands.push(parsedCommand.data);
    await saveDb();
  } catch (error) {
    console.error("Error adding command to database:", error);
  }
}

// Remove command from Database
export async function removeCommand(id: string) {
  try {
    if (db.data) {
      db.data.commands = db.data.commands.filter(
        (command: { id: string }) => command.id !== id
      );
      await saveDb();
    }
  } catch (error) {
    console.error("Error removing command from database:", error);
  }
}

// Get All commands from Database
export function getAllCommands() {
  return db.data?.commands || [];
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
export async function syncInventory(inventory: InventoryItemType[]) {
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
