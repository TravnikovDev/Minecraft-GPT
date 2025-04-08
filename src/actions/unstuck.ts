import { bot } from "../index";
import { moveAway } from "./movement";
import { SERVER_HOST, SERVER_PORT } from "../config/env";
import mineflayer from "mineflayer";

// Keep track of unstuck attempts
let unstuckAttempts = 0;
const MAX_NORMAL_ATTEMPTS = 3;
const UNSTUCK_COOLDOWN = 60000; // 1 minute cooldown between major unstuck attempts
let lastUnstuckTime = 0;
let isRelogging = false;

// Function to attempt to unstuck the bot from various situations
export async function unstuck(): Promise<boolean> {
  const now = Date.now();
  console.log("Executing unstuck procedure");
  
  // Check if we're already handling a relog
  if (isRelogging) {
    console.log("Already handling a relog. Waiting for it to complete.");
    return false;
  }
  
  // If we've tried unstuck too many times in a short period, try relogging
  if (unstuckAttempts >= MAX_NORMAL_ATTEMPTS && (now - lastUnstuckTime) > UNSTUCK_COOLDOWN) {
    console.log(`Multiple unstuck attempts failed. Attempting to relog to the server.`);
    return await relogToServer();
  }
  
  // Increment unstuck attempts counter
  unstuckAttempts++;
  lastUnstuckTime = now;
  
  let unstuckSuccessful = false;

  try {
    // Step 1: Cancel any ongoing pathfinding
    if (bot.pathfinder.isMoving()) {
      bot.pathfinder.stop();
      console.log("- Stopped active pathfinding");
    }
    
    // Step 2: Try to exit vehicle if in one
    // @ts-ignore - vehicle property exists at runtime but is not in the type definition
    if (bot.vehicle) {
      try {
        // @ts-ignore - dismount method exists at runtime but is not in the type definition
        bot.dismount();
        console.log("- Dismounted from vehicle");
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for dismount to complete
        unstuckSuccessful = true;
      } catch (error) {
        console.log("- Not in a vehicle or failed to dismount");
      }
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
      const directions = ['forward', 'back', 'left', 'right'] as const;
      for (const direction of directions) {
        bot.setControlState(direction, true);
        await new Promise(resolve => setTimeout(resolve, 500));
        bot.setControlState(direction, false);
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      
      console.log("- Attempted emergency unstuck procedures");
    }
    
    // Reset the attempt counter if we were successful
    if (unstuckSuccessful) {
      unstuckAttempts = 0;
    }
    
    return unstuckSuccessful;
  } catch (error) {
    console.error("Error in unstuck procedure:", error);
    return false;
  }
}

/**
 * Relogs the bot to the server while preserving the command queue
 * This is a last resort when normal unstuck methods fail
 */
async function relogToServer(): Promise<boolean> {
  isRelogging = true;
  
  try {
    console.log("Starting relog procedure...");
    
    // Save the username before disconnecting
    const username = bot.username;
    
    // End the current bot instance
    bot.quit("Relogging to fix being stuck");
    
    // Wait a moment for the connection to fully close
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log(`Reconnecting to server ${SERVER_HOST}:${SERVER_PORT} as ${username}...`);
    
    // Create a new bot instance with the same credentials
    const connectionOptions = {
      host: SERVER_HOST,
      port: SERVER_PORT,
      username: username,
    };
    
    // Wait for the new bot to spawn
    await new Promise<void>((resolve, reject) => {
      const newBot = mineflayer.createBot(connectionOptions);
      
      newBot.once('spawn', () => {
        console.log("Successfully reconnected to server!");
        
        // Reset the unstuck counter since we've successfully relogged
        unstuckAttempts = 0;
        isRelogging = false;
        
        // Note: The command queue is preserved because it's stored in the database
        resolve();
      });
      
      newBot.once('error', (err) => {
        console.error("Error reconnecting to server:", err);
        isRelogging = false;
        reject(err);
      });
      
      // Set a timeout in case the reconnection hangs
      setTimeout(() => {
        if (isRelogging) {
          isRelogging = false;
          reject(new Error("Reconnection timeout"));
        }
      }, 30000);
    });
    
    return true;
  } catch (error) {
    console.error("Failed to relog to the server:", error);
    isRelogging = false;
    return false;
  }
}
