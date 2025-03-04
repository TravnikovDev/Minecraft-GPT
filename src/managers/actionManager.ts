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

// Store currently executing command and its start time
let currentCommand: CommandType | null = null;
let actionStartTime: number | null = null;
let lastBotPosition = { x: 0, y: 0, z: 0 };
let botStuckCounter = 0;

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
    // Optionally adjust priority or add retry count
    nextCommand.retryCount = (nextCommand.retryCount || 0) - 1;
    if (nextCommand.retryCount >= 0) {
      await addCommandToQueue(nextCommand);
      nextCommand.priority += 1;
    }
    console.log(`Re-added command ${nextCommand.command} to queue for retry.`);
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
  if (!currentCommand || !actionStartTime) return;
  
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
    
  if (!hasMovementProgress) {
    botStuckCounter++;
    console.log(`Bot hasn't moved while executing ${currentCommand.command}. Stuck counter: ${botStuckCounter}`);
    
    // If bot hasn't moved for multiple checks, consider it stuck
    if (botStuckCounter >= 3) {
      console.log(`Bot appears to be stuck while executing ${currentCommand.command}. Initiating recovery.`);
      await handleStuckAction();
      return;
    }
  } else {
    // Reset stuck counter if there's movement
    botStuckCounter = 0;
    lastBotPosition = currentPosition.clone();
  }
  
  // Continue monitoring if not stuck
  setTimeout(checkActionProgress, ACTION_CHECK_INTERVAL);
}

// Handle a stuck action by attempting recovery
async function handleStuckAction() {
  if (!currentCommand) return;
  
  console.log(`Recovering from stuck action: ${currentCommand.command}`);
  
  try {
    // Try to unstuck the bot using our action
    const unstuckSuccess = await unstuck();
    
    // Remove the stuck command from the queue
    if (currentCommand.id) {
      await removeCommand(currentCommand.id);
    }
    
    // Reset tracking variables
    currentCommand = null;
    actionStartTime = null;
    botStuckCounter = 0;
    
    console.log(`Unstuck attempt ${unstuckSuccess ? 'successful' : 'may have failed'}`);
    
  } catch (error) {
    console.error("Error during stuck action recovery:", error);
  }
}

// Execute Commands in Queue
export async function executeCommands() {
  const commands = await getAllCommands();
  
  if (commands.length === 0) {
    return;
  }
  
  // Only process new commands if we're not currently processing one
  if (currentCommand === null) {
    commands.sort((a, b) => a.priority - b.priority);
    for (const command of commands) {
      try {
        console.log(
          `- Executing command ${command.command} with priority ${command.priority}`
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
