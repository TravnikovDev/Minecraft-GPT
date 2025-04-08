// Path: src/managers/commandManager.ts

import {
  addCommandToQueue,
  getAllCommands,
  removeCommand,
} from "./persistenceManager";
import { executeTool } from "./toolManager";
import type { CommandType } from "../schemas/types";
import { bot } from "..";
import { unstuck } from "../actions/unstuck";

// Constants for action monitoring
const MAX_ACTION_EXECUTION_TIME = 30000; // 30 seconds timeout for any action
const ACTION_CHECK_INTERVAL = 5000; // Check action progress every 5 seconds
const STUCK_THRESHOLD = 3;          // Number of consecutive checks without movement to trigger unstuck

// Store currently executing command and its start time
let currentCommand: CommandType | null = null;
let actionStartTime: number | null = null;
let lastBotPosition = { x: 0, y: 0, z: 0 };
let botStuckCounter = 0;
let recoveryInProgress = false;

// Process an Command
async function processCommand(nextCommand: CommandType) {
  let success = false;
  try {
    // Record the command being executed and its start time
    currentCommand = nextCommand;
    actionStartTime = Date.now();
    lastBotPosition = bot.entity.position.clone();
    
    // Start monitoring this action
    const timeoutId = startActionMonitoring();
    
    // Execute the action
    await executeTool(nextCommand.command, nextCommand.args);
    
    // Clear the monitoring since action completed successfully
    clearTimeout(timeoutId);
    currentCommand = null;
    actionStartTime = null;
    success = true;
  } catch (error) {
    console.error(`Error executing command ${nextCommand.command}:`, error);
    
    // Check if this is a retry-worthy error
    if (!recoveryInProgress) {
      // Optionally adjust priority or add retry count
      nextCommand.retryCount = (nextCommand.retryCount || 0) - 1;
      if (nextCommand.retryCount >= 0) {
        // Increase priority slightly with each retry
        const newPriority = Math.max(1, (nextCommand.priority || 5) - 1);
        await addCommandToQueue({
          ...nextCommand,
          priority: newPriority
        });
        console.log(`Re-added command ${nextCommand.command} to queue for retry with priority ${newPriority}.`);
      }
    }
  } finally {
    if (success) {
      try {
        await removeCommand(nextCommand.id);
        // Reset the stuck counter on successful command completion
        botStuckCounter = 0;
      } catch (error) {
        console.error(
          `Error removing command ${nextCommand.id} from queue:`,
          error
        );
      }
    }
    // Reset current tracking variables if they haven't been already
    currentCommand = null;
    actionStartTime = null;
  }
}

// Function to start monitoring an action for timeouts and stuck states
function startActionMonitoring() {
  return setTimeout(checkActionProgress, ACTION_CHECK_INTERVAL);
}

// Check if the current action is making progress
async function checkActionProgress() {
  if (!currentCommand || !actionStartTime || recoveryInProgress) return;
  
  const currentTime = Date.now();
  const executionTime = currentTime - actionStartTime;
  
  // Check if action has exceeded maximum execution time
  if (executionTime > MAX_ACTION_EXECUTION_TIME) {
    console.log(`Action ${currentCommand.command} has timed out after ${executionTime}ms. Cancelling.`);
    await handleStuckAction();
    return;
  }
  
  // Check if bot's position has changed since last check
  const currentPosition = bot.entity.position;
  const hasMovementProgress = 
    Math.abs(currentPosition.x - lastBotPosition.x) > 0.1 ||
    Math.abs(currentPosition.y - lastBotPosition.y) > 0.1 ||
    Math.abs(currentPosition.z - lastBotPosition.z) > 0.1;
    
  if (!hasMovementProgress && bot.pathfinder.isMoving()) {
    botStuckCounter++;
    console.log(`Bot hasn't moved while executing ${currentCommand.command}. Stuck counter: ${botStuckCounter}`);
    
    // If bot hasn't moved for multiple checks, consider it stuck
    if (botStuckCounter >= STUCK_THRESHOLD) {
      console.log(`Bot appears to be stuck while executing ${currentCommand.command}. Initiating recovery.`);
      await handleStuckAction();
      return;
    }
  } else {
    // Reset stuck counter if there's movement
    botStuckCounter = Math.max(0, botStuckCounter - 1);
    lastBotPosition = currentPosition.clone();
  }
  
  // Continue monitoring if not stuck
  setTimeout(checkActionProgress, ACTION_CHECK_INTERVAL);
}

// Handle a stuck action by attempting recovery
async function handleStuckAction() {
  if (!currentCommand || recoveryInProgress) return;
  
  recoveryInProgress = true;
  console.log(`Recovering from stuck action: ${currentCommand.command}`);
  
  try {
    // Try to unstuck the bot using our action
    const unstuckSuccess = await unstuck();
    
    if (unstuckSuccess) {
      console.log("Unstuck successful. Continuing with command execution.");
      // If unstuck was successful, don't remove the command - let it continue execution
      // Just reset the monitoring variables
      actionStartTime = Date.now(); // Reset timer
      lastBotPosition = bot.entity.position.clone();
      botStuckCounter = 0;
    } else {
      console.log("Unstuck failed. Removing current command and continuing with next command.");
      // Remove the stuck command from the queue if unstuck failed
      if (currentCommand.id) {
        await removeCommand(currentCommand.id);
      }
      // Reset tracking variables
      currentCommand = null;
      actionStartTime = null;
    }
  } catch (error) {
    console.error("Error during stuck action recovery:", error);
    
    // If unstuck fails with an error, remove the command to prevent getting stuck in a loop
    if (currentCommand?.id) {
      await removeCommand(currentCommand.id);
    }
    
    // Reset tracking variables
    currentCommand = null;
    actionStartTime = null;
  } finally {
    botStuckCounter = 0;
    recoveryInProgress = false;
  }
}

// Event handler for when bot rejoins after a disconnect (to be attached in index.ts)
export function handleBotRejoin() {
  console.log("Bot rejoined the server. Resetting action state and continuing execution.");
  currentCommand = null;
  actionStartTime = null;
  botStuckCounter = 0;
  recoveryInProgress = false;
}

// Execute Commands in Queue
export async function executeCommands() {
  // Skip if we're in the middle of recovery
  if (recoveryInProgress) {
    return;
  }
  
  const commands = await getAllCommands();
  
  if (commands.length === 0) {
    return;
  }
  
  // Only process new commands if we're not currently processing one
  if (currentCommand === null) {
    // Sort commands by priority (lower number = higher priority)
    commands.sort((a, b) => (a.priority || 5) - (b.priority || 5));
    
    for (const command of commands) {
      try {
        console.log(
          `- Executing command ${command.command} with priority ${command.priority || 5}`
        );
        await processCommand(command);
        break; // Only process one command per cycle
      } catch (error) {
        console.error("Error executing commands:", error);
      }
    }
  } else {
    // If a command is already being processed, log that we're waiting
    const elapsedTime = actionStartTime ? Date.now() - actionStartTime : 0;
    console.log(`Still executing command ${currentCommand.command} (${elapsedTime}ms elapsed)`);
  }
}
