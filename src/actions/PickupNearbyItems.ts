// Path: src/actions/PickupNearbyItems.ts

import { z } from "zod";
import { bot } from "../index";
import { pickupNearbyItems } from "../utils/worldInteraction";

// Define parameters for PickupNearbyItems action
export const parameters = z.object({});

// Implement the PickupNearbyItems action
export async function execute(args: any) {
  console.log(`Collecting items nearby`);

  await pickupNearbyItems(bot);
}
