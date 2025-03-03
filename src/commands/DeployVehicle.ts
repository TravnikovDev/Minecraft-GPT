import { z } from "zod";
import { deployVehicle } from "../actions/worldInteraction.js";
import { bot } from "../index.js";

export const description = `Makes the bot deploy a vehicle (minecart, boat) in the world or place a saddle on an animal.
For minecarts, the bot will find nearby rails to place it on.
For boats, the bot will find nearby water to place it in.
For saddles, the bot will find nearby rideable animals to place it on.
Expected usage: 
- "Deploy a minecart" or "Place minecart on tracks"
- "Deploy a boat" or "Place boat in water"
- "Put a saddle on that horse" or "Saddle the pig"`;

// Define parameters for the DeployVehicle action
export const parameters = z.object({
  vehicleType: z.string().describe("The type of vehicle to deploy (minecart, boat) or 'saddle' to saddle an animal"),
  maxDistance: z.number().optional().describe("Maximum distance to search for a suitable placement location (default: 16 blocks)")
});

// Implement the DeployVehicle action
export async function execute(args: any): Promise<void> {
  console.log(`Executing DeployVehicle with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Missing or invalid parameters for DeployVehicle: vehicleType is required.`);
    return;
  }

  const { vehicleType, maxDistance = 16 } = parsed.data;
  
  // Call the action to deploy the vehicle
  const result = await deployVehicle(vehicleType, maxDistance);
  
  // Report the result
  if (result) {
    const message = `Successfully deployed ${vehicleType}.`;
    console.log(message);
    try {
      bot.chat(message);
    } catch (error) {
      console.error("Failed to send message to chat:", error);
    }
  } else {
    const message = `Could not deploy ${vehicleType}. Make sure you have the item and are near a suitable location.`;
    console.log(message);
    try {
      bot.chat(message);
    } catch (error) {
      console.error("Failed to send message to chat:", error);
    }
  }
}
