// Path: src/managers/persistenceManager.ts

import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { resolve } from "path";
import { z } from "zod";
import type {
  ChestType,
  CommandType,
  DbSchemaType,
  InventoryItemType,
  MineType,
  PositionType,
} from "../schemas/types";
import {
  CommandSchema,
  DbSchema,
  InventorySchema,
  MineSchema,
  PositionSchema,
} from "../schemas/mainSchemas";
import type { DirectionType } from "../actions/digging";

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

export async function removeAllCommands() {
  try {
    if (db.data) {
      db.data.commands = [];
      await saveDb();
    }
  } catch (error) {
    console.error("Error removing all commands from database:", error);
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
export function getAllLoreEvents(): string[] {
  return db.data?.lore?.events || [];
}

// Sync Inventory with Database
export async function syncInventory(
  inventory: InventoryItemType[]
): Promise<void> {
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
export function getInventory(): InventoryItemType[] {
  return db.data?.inventory || [];
}

// Set Base Location
export async function saveBaseLocation(
  baseName = "defaultBaseName",
  location: PositionType
) {
  try {
    const parsedLocation = PositionSchema.safeParse(location);
    if (!parsedLocation.success) {
      throw new Error(
        "Base location validation failed: " + parsedLocation.error
      );
    }
    if (db.data) {
      db.data.baseLocation = {
        baseName,
        location: parsedLocation.data,
        craftTable: [],
        furnace: [],
        chests: [],
        mines: [],
      };
      await saveDb();
    }
  } catch (error) {
    console.error("Error setting base location in database:", error);
  }
}

export async function saveBasementLocation(location: PositionType) {
  try {
    const parsedLocation = PositionSchema.safeParse(location);
    if (!parsedLocation.success) {
      throw new Error(
        "Basement location validation failed: " + parsedLocation.error
      );
    }
    if (db.data?.baseLocation) {
      db.data.baseLocation.basementLocation = parsedLocation.data;
      await saveDb();
    }
  } catch (error) {
    console.error("Error setting basement location in database:", error);
  }
}

// save Crafting Table
export async function saveCraftingTableLocation(
  position: PositionType
): Promise<void> {
  try {
    const parsedPosition = PositionSchema.safeParse(position);
    if (!parsedPosition.success) {
      throw new Error(
        "Crafting table position validation failed: " + parsedPosition.error
      );
    }
    if (db.data?.baseLocation) {
      db.data.baseLocation.craftTable.push(parsedPosition.data);
      await saveDb();
    }
  } catch (error) {
    console.error("Error placing crafting table in database:", error);
  }
}

// save Furnace
export async function saveFurnaceLocation(
  position: PositionType
): Promise<void> {
  try {
    const parsedPosition = PositionSchema.safeParse(position);
    if (!parsedPosition.success) {
      throw new Error(
        "Furnace position validation failed: " + parsedPosition.error
      );
    }
    if (db.data?.baseLocation) {
      db.data.baseLocation.furnace?.push(parsedPosition.data);
      await saveDb();
    }
  } catch (error) {
    console.error("Error placing furnace in database:", error);
  }
}

// save Chest
export async function saveChestLocation(position: PositionType): Promise<void> {
  try {
    const parsedPosition = PositionSchema.safeParse(position);
    if (!parsedPosition.success) {
      throw new Error(
        "Chest position validation failed: " + parsedPosition.error
      );
    }
    if (db.data?.baseLocation) {
      db.data.baseLocation.chests.push({
        type: "Miscellaneous", // or another appropriate type
        location: parsedPosition.data,
        items: [],
      });
      await saveDb();
    }
  } catch (error) {
    console.error("Error placing chest in database:", error);
  }
}
// TODO: update chest items function

// save Mine
export async function saveMineLocation(mine: {
  name: string;
  direction: DirectionType;
  startsAt: PositionType;
  endsAt: PositionType;
  depth: number;
}): Promise<void> {
  try {
    const parsedMine = MineSchema.safeParse(mine);
    if (!parsedMine.success) {
      throw new Error("Mine validation failed: " + parsedMine.error);
    }
    if (db.data?.baseLocation) {
      if (!db.data.baseLocation.mines) {
        db.data.baseLocation.mines = [];
      }
      db.data.baseLocation.mines.push(parsedMine.data);
      await saveDb();
    }
  } catch (error) {
    console.error("Error digging mine in database:", error);
  }
}

// Get Base Location
export function getBaseLocation(): PositionType | undefined {
  return db.data?.baseLocation?.location;
}

export function getBasementLocation(): PositionType | undefined {
  return db.data?.baseLocation?.basementLocation;
}

// Get Crafting Table
export function getCraftingTables(): PositionType[] | undefined {
  return db.data?.baseLocation?.craftTable;
}

// Get Furnace
export function getFurnaces(): PositionType[] | undefined {
  return db.data?.baseLocation?.furnace;
}

// Get Chests
export function getChests(): ChestType[] | undefined {
  return db.data?.baseLocation?.chests;
}

// Get Mines
export function getMines(): MineType[] | undefined {
  return db.data?.baseLocation?.mines;
}
