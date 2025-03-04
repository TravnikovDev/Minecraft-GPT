import { bot } from "../index";
import { Vec3 } from "vec3";
import { goals } from "mineflayer-pathfinder";
import { moveAway } from "./movement";

// Function to attempt to unstuck the bot from various situations
export async function unstuck(): Promise<boolean> {
  console.log("Executing unstuck procedure");
  let unstuckSuccessful = false;

  try {
    // Step 1: Cancel any ongoing pathfinding
    if (bot.pathfinder.isMoving()) {
      bot.pathfinder.stop();
      console.log("- Stopped active pathfinding");
    }
    
    // Step 2: Try to exit vehicle if in one
    if (bot.vehicle) {
      bot.dismount();
      console.log("- Dismounted from vehicle");
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for dismount to complete
      unstuckSuccessful = true;
    }
    
    // Step 3: Try to find a safe place to move to
    try {
      await moveAway(5); // Move 5 blocks away in a random direction
      console.log("- Successfully moved to a new position");
      unstuckSuccessful = true;
    } catch (error) {
      console.log("- Failed to move away:", error);
    }
    
    // Step 4: If still stuck, try more drastic measures
    if (!unstuckSuccessful) {
      // Try to jump a few times
      for (let i = 0; i < 3; i++) {
        bot.setControlState('jump', true);
        await new Promise(resolve => setTimeout(resolve, 250));
        bot.setControlState('jump', false);
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      
      // Try to move in random directions
      const directions = ['forward', 'back', 'left', 'right'];
      for (const direction of directions) {
        bot.setControlState(direction, true);
        await new Promise(resolve => setTimeout(resolve, 500));
        bot.setControlState(direction, false);
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      
      console.log("- Attempted emergency unstuck procedures");
    }
    
    return true;
  } catch (error) {
    console.error("Error in unstuck procedure:", error);
    return false;
  }
}
