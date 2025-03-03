import { z } from "zod";
import { useNearbyObject } from "../actions/worldInteraction.js";
import { bot } from "../index.js";

export const description = `Makes the bot interact with a nearby object such as vehicles, animals, or interactive blocks.
The bot can use, enter, exit, toggle, switch on/off various objects, or mount/dismount rideable entities.
Expected usage: 
- "Use the nearby boat" or "Get in the minecart" or "Exit the boat" or "Get out of minecart"
- "Press the button" or "Pull the lever" or "Toggle the lever" or "Switch off the lever"
- "Open the door" or "Open the chest" or "Use the crafting table"
- "Ride the horse" or "Mount the camel" or "Get on the pig" or "Dismount the animal"`;

// Define parameters for the UseNearbyObject action
export const parameters = z.object({
  objectType: z.string().describe("The type of object to interact with (boat, minecart, horse, camel, button, lever, door, etc.)"),
  action: z.string().optional().describe("The action to perform (use, enter, exit, ride, mount, dismount, toggle, etc.)"),
  maxDistance: z.number().optional().describe("Maximum distance to search for the object (default: 16 blocks)")
});

// Implement the UseNearbyObject action
export async function execute(args: any): Promise<void> {
  console.log(`Executing UseNearbyObject with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Missing or invalid parameters for UseNearbyObject: objectType is required.`);
    return;
  }

  const { objectType, action = "use", maxDistance = 16 } = parsed.data;
  
  // Process action variants
  let normalizedAction = action.toLowerCase();
  
  // Map action variations to standard actions
  if (normalizedAction.includes("exit") || normalizedAction.includes("leave") || 
      normalizedAction.includes("get out") || normalizedAction.includes("dismount")) {
    normalizedAction = "exit";
  } else if (normalizedAction.includes("enter") || normalizedAction.includes("get in") || 
             normalizedAction.includes("sit in") || normalizedAction.includes("ride") || 
             normalizedAction.includes("mount") || normalizedAction.includes("get on")) {
    normalizedAction = "enter";
  } else if (normalizedAction.includes("toggle") || normalizedAction.includes("switch") ||
             normalizedAction.includes("flip") || normalizedAction.includes("turn")) {
    normalizedAction = "use";  // Toggle functionality is handled by the activateBlock method
  }
  
  // Call the action to use the nearby object
  const result = await useNearbyObject(objectType, maxDistance, normalizedAction);
  
  // Report the result
  if (result) {
    let message = "";
    
    if (normalizedAction === "exit") {
      message = `Successfully got out of the ${objectType}.`;
    } else if (normalizedAction === "enter") {
      message = `Successfully got into the ${objectType}.`;
    } else {
      message = `Successfully used the ${objectType}.`;
    }
    
    console.log(message);
    try {
      bot.chat(message);
    } catch (error) {
      console.error("Failed to send message to chat:", error);
    }
  } else {
    let message = "";
    
    if (normalizedAction === "exit") {
      message = `Could not exit the ${objectType}.`;
    } else if (normalizedAction === "enter") {
      message = `Could not enter the ${objectType}.`;
    } else {
      message = `Could not find or use the ${objectType}.`;
    }
    
    console.log(message);
    try {
      bot.chat(message);
    } catch (error) {
      console.error("Failed to send message to chat:", error);
    }
  }
}
