// Path: src/managers/loreManager.ts

import { addLoreEvent, getAllLoreEvents } from "./persistenceManager";
import { z } from "zod";

// Define lore event schema
const loreEventSchema = z.object({
  event: z
    .string()
    .min(1, "Event description cannot be empty.")
    .describe("A description of the lore event."),
});

// Add a new lore event to the database
export async function addNewLoreEvent(event: string): Promise<void> {
  try {
    // Validate the lore event before adding it to the database
    loreEventSchema.parse({ event });
    await addLoreEvent(event);
    console.log(`Added lore event: ${event}`);
  } catch (error) {
    console.error("Error adding lore event:", error);
  }
}

// Get all lore events from the database
export function fetchAllLoreEvents(): string[] {
  try {
    const events = getAllLoreEvents();
    console.log("Fetched all lore events.");
    return events;
  } catch (error) {
    console.error("Error fetching lore events:", error);
    return [];
  }
}

// Add lore event based on specific bot action
export async function addLoreForAction(action: string): Promise<void> {
  const eventDescription = `Bot performed action: ${action}`;
  await addNewLoreEvent(eventDescription);
}

// Function to format lore events for display
export function formatLoreEvents(events: string[]): string {
  if (events.length === 0) return "No lore events available.";
  return events.map((event, index) => `${index + 1}. ${event}`).join("\n");
}
