// Path: src/managers/actionManager.ts
// Runs queued commands one at a time, watches them for timeouts or getting
// stuck, and lets a running command be cancelled (e.g. by "stop").

import {
  addCommandToQueue,
  getAllCommands,
  removeAllCommands,
  removeCommand,
} from "./persistenceManager";
import { getCurrentCommandName, isCommandCancelled, runWithSignal, setCurrentCommandName } from "../core/commandContext";
import { executeTool } from "./toolManager";
import type { CommandType } from "../schemas/types";
import { bot } from "../core/body";
import { unstuck } from "../actions/unstuck";
import { isAnyReflexActive } from "../core/reflexes";
import { fighting, pathing } from "../core/plugins";

// "Doing nothing" watchdog: no movement and no inventory change for this long
// means the command is hung (e.g. staring at a block it can't dig)
const NO_PROGRESS_MS = 45 * 1000;
let lastProgressAt = Date.now();
let lastProgressPos = { x: 0, y: 0, z: 0 };
let lastInventorySignature = "";

function inventorySignature(): string {
  return bot.inventory
    .items()
    .map((i) => `${i.name}:${i.count}`)
    .sort()
    .join(",");
}

/** Records progress (movement or inventory change) for the watchdog. */
function noteProgress(): void {
  const pos = bot.entity?.position;
  if (!pos) return;
  const moved = Math.hypot(pos.x - lastProgressPos.x, pos.y - lastProgressPos.y, pos.z - lastProgressPos.z) > 1;
  const signature = inventorySignature();
  if (moved || signature !== lastInventorySignature || isAnyReflexActive()) {
    lastProgressAt = Date.now();
    lastProgressPos = { x: pos.x, y: pos.y, z: pos.z };
    lastInventorySignature = signature;
  }
}

// Constants for action monitoring
const MAX_ACTION_EXECUTION_TIME = 5 * 60 * 1000; // Cancel any command running longer than 5 minutes
// Long trips and gathering legitimately take longer; the stuck watcher still
// catches a command that stops making progress
const LONG_RUNNING_LIMITS: Record<string, number> = {
  goToCoordinates: 30 * 60 * 1000,
  goToPlayer: 30 * 60 * 1000,
  goToNamedLocation: 30 * 60 * 1000,
  returnToBase: 30 * 60 * 1000,
  gatherWood: 15 * 60 * 1000,
  collectBlocks: 15 * 60 * 1000,
  hunting: 10 * 60 * 1000,
};
const ACTION_CHECK_INTERVAL = 5000; // Check action progress every 5 seconds
const STUCK_THRESHOLD = 3;          // Number of consecutive checks without movement to trigger unstuck
const MAX_RECOVERIES_PER_COMMAND = 2; // Cancel the command if it is still stuck after this many unstuck attempts

// Store currently executing command and its start time
let currentCommand: CommandType | null = null;
let actionStartTime: number | null = null;
let lastBotPosition = { x: 0, y: 0, z: 0 };
let botStuckCounter = 0;
let recoveryInProgress = false;
let recoveriesForCurrentCommand = 0;
let currentAbort: AbortController | null = null;

// Each command runs with its own abort signal in async context, so code that
// keeps running after its command was cancelled still sees the cancellation.
// Re-exported for managers that already import them from here
export { getCurrentCommandName, isCommandCancelled };

/** Stops all bot movement, combat and digging immediately. */
function haltBot(): void {
  try {
    pathing.stop();
    pathing.setGoal(null);
    fighting.stop();
    bot.stopDigging();
    bot.clearControlStates();
  } catch (error) {
    console.error("Error while halting bot:", error);
  }
}

/**
 * Cancels the running command (if any): aborts it, stops the bot and removes
 * it from the queue so the next command can start right away.
 */
export async function cancelCurrentCommand(reason: string): Promise<void> {
  const command = currentCommand;
  if (command) {
    console.log(`Cancelling command ${command.command}: ${reason}`);
    currentAbort?.abort(reason);
    await removeCommand(command.id);
  }
  haltBot();
}

/**
 * Handles "stop" immediately instead of queueing it behind the running
 * command: cancels the current command and clears the whole queue.
 */
export async function stopEverything(): Promise<void> {
  await cancelCurrentCommand("Stopped by player");
  await removeAllCommands();
}

// Process an Command
async function processCommand(nextCommand: CommandType) {
  let success = false;
  const abort = new AbortController();
  try {
    // Record the command being executed and its start time
    currentCommand = nextCommand;
    setCurrentCommandName(nextCommand.command);
    currentAbort = abort;
    actionStartTime = Date.now();
    lastBotPosition = bot.entity?.position.clone() ?? lastBotPosition;
    recoveriesForCurrentCommand = 0;
    lastProgressAt = Date.now();
    noteProgress();
    
    // Start monitoring this action
    const timeoutId = startActionMonitoring();
    
    // Execute the action, but stop waiting as soon as it is cancelled
    const aborted = new Promise<"aborted">((resolve) =>
      abort.signal.addEventListener("abort", () => resolve("aborted"), { once: true })
    );
    const outcome = await Promise.race([
      runWithSignal(abort.signal, () => executeTool(nextCommand.command, nextCommand.args))
        .then(() => "done" as const),
      aborted,
    ]);
    
    // Clear the monitoring since action has finished
    clearTimeout(timeoutId);
    if (outcome === "aborted") {
      console.log(`Command ${nextCommand.command} was cancelled.`);
      return; // cancelCurrentCommand already removed it from the queue
    }
    success = true;
  } catch (error) {
    console.error(`Error executing command ${nextCommand.command}:`, error);
    
    // A failed command always leaves the queue; otherwise it would re-run every
    // cycle forever (re-adding it was skipped as a duplicate of itself)
    await removeCommand(nextCommand.id);

    // Re-queue only if it has retries left (cancelled commands are not retried)
    if (!recoveryInProgress && !abort.signal.aborted) {
      nextCommand.retryCount = (nextCommand.retryCount || 0) - 1;
      if (nextCommand.retryCount >= 0) {
        // Increase priority slightly with each retry
        const newPriority = Math.max(1, (nextCommand.priority ?? 5) - 1);
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
    // Reset tracking only if no newer command has started meanwhile
    if (currentCommand === nextCommand) {
      currentCommand = null;
      setCurrentCommandName(null);
      actionStartTime = null;
      currentAbort = null;
    }
  }
}

// Function to start monitoring an action for timeouts and stuck states
function startActionMonitoring() {
  return setTimeout(checkActionProgress, ACTION_CHECK_INTERVAL);
}

// Check if the current action is making progress
async function checkActionProgress() {
  if (!currentCommand || !actionStartTime || recoveryInProgress) return;

  // Disconnected (bot.entity is gone until the reconnect spawns): the
  // reconnect handler resets command state, so just stop watching
  if (!bot.entity) return;
  
  const currentTime = Date.now();
  const executionTime = currentTime - actionStartTime;
  
  // Check if action has exceeded maximum execution time
  const limit = LONG_RUNNING_LIMITS[currentCommand.command] ?? MAX_ACTION_EXECUTION_TIME;
  if (executionTime > limit) {
    console.log(`Action ${currentCommand.command} has timed out after ${executionTime}ms. Cancelling.`);
    bot.chat(`That took too long, so I stopped doing ${currentCommand.command}.`);
    await cancelCurrentCommand("timed out");
    return;
  }
  
  // Hung without moving or gaining/using items for a while: treat as stuck
  noteProgress();
  if (Date.now() - lastProgressAt > NO_PROGRESS_MS) {
    console.log(`No progress on ${currentCommand.command} for ${NO_PROGRESS_MS / 1000}s. Initiating recovery.`);
    lastProgressAt = Date.now(); // give the recovery its own window
    await handleStuckAction();
    return;
  }

  // Check if bot's position has changed since last check
  const currentPosition = bot.entity.position;
  const hasMovementProgress = 
    Math.abs(currentPosition.x - lastBotPosition.x) > 0.1 ||
    Math.abs(currentPosition.y - lastBotPosition.y) > 0.1 ||
    Math.abs(currentPosition.z - lastBotPosition.z) > 0.1;
    
  if (!hasMovementProgress && pathing.isMoving()) {
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
  
  // Give up on the command if unstucking hasn't helped
  if (recoveriesForCurrentCommand >= MAX_RECOVERIES_PER_COMMAND) {
    console.log(`Still stuck after ${recoveriesForCurrentCommand} recoveries. Giving up on ${currentCommand.command}.`);
    bot.chat(`I'm stuck, so I gave up on ${currentCommand.command}.`);
    await cancelCurrentCommand("stuck");
    return;
  }

  recoveryInProgress = true;
  recoveriesForCurrentCommand++;
  console.log(`Recovering from stuck action: ${currentCommand.command}`);
  
  try {
    // Try to unstuck the bot using our action
    const unstuckSuccess = await unstuck();
    
    if (unstuckSuccess) {
      console.log("Unstuck successful. Continuing with command execution.");
      // If unstuck was successful, don't remove the command - let it continue execution
      // Just reset the monitoring variables
      actionStartTime = Date.now(); // Reset timer
      lastBotPosition = bot.entity?.position.clone() ?? lastBotPosition;
      botStuckCounter = 0;
      // Keep monitoring the resumed command
      setTimeout(checkActionProgress, ACTION_CHECK_INTERVAL);
    } else {
      console.log("Unstuck failed. Cancelling current command and continuing with next command.");
      await cancelCurrentCommand("unstuck failed");
    }
  } catch (error) {
    console.error("Error during stuck action recovery:", error);
    // Cancel the command to prevent getting stuck in a loop
    await cancelCurrentCommand("recovery error");
  } finally {
    botStuckCounter = 0;
    recoveryInProgress = false;
  }
}

// Event handler for when bot rejoins after a disconnect (to be attached in index.ts)
export function handleBotRejoin() {
  console.log("Bot rejoined the server. Resetting action state and continuing execution.");
  currentAbort?.abort("bot rejoined");
  currentAbort = null;
  currentCommand = null;
  setCurrentCommandName(null);
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
    commands.sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5));
    
    for (const command of commands) {
      try {
        console.log(
          `- Executing command ${command.command} with priority ${command.priority ?? 5}`
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
