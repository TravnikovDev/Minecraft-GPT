// Path: src/actions/PickupNearbyItems.ts

import { z } from "zod";
import { bot } from "../index";
import { pickupNearbyItems } from "../actions/worldInteraction";

export const description = `When user asks the bot to pick up nearby items, the bot will search for items on the ground
within a specified radius and pick them up. Example: "Pick up nearby items", "Collect items nearby".`;

// Define parameters for PickupNearbyItems action
export const parameters = z.object({});

// Implement the PickupNearbyItems action
export async function execute() {
  console.log(`Collecting items nearby`);

  await pickupNearbyItems(bot);
}
