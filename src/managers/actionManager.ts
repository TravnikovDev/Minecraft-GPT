// Path: src/managers/commandManager.ts

import {
  addCommandToQueue,
  getAllCommands,
  removeCommand,
} from "./persistenceManager";
import { executeTool } from "./toolManager";
import type { CommandType } from "../schemas/types";

// Process an Command
async function processCommand(nextCommand: CommandType) {
  let success = false;
  try {
    await executeTool(nextCommand.command, nextCommand.args);
    success = true;
  } catch (error) {
    console.error(`Error executing command ${nextCommand.command}:`, error);
    // Optionally adjust priority or add retry count
    nextCommand.retryCount = (nextCommand.retryCount || 0) + 1;
    await addCommandToQueue(nextCommand);
    console.log(`Re-added command ${nextCommand.command} to queue for retry.`);
  } finally {
    if (success) {
      try {
        await removeCommand(nextCommand.id);
      } catch (error) {
        console.error(
          `Error removing command ${nextCommand.id} from queue:`,
          error
        );
      }
    }
  }
}

// Execute Commands in Queue
export async function executeCommands() {
  const commands = await getAllCommands();
  // console.log("- Executing commands in queue...");

  if (commands.length === 0) {
    // console.log("- No commands in queue. Attempting idle tasks...");
    // await handleIdleState();
    return;
  }

  commands.sort((a, b) => a.priority - b.priority);
  for (const command of commands) {
    try {
      console.log(
        `- Executing command ${command.command} with priority ${command.priority}`
      );
      await processCommand(command);
    } catch (error) {
      console.error("Error executing commands:", error);
    }
  }
}

// Handle Idle State by assigning tasks based on bot progress
// async function handleIdleState() {
//   const botProgress = new BotProgress();
//   const currentLevel = botProgress.getCurrentLevel();
//   console.log(`! Bot is idle. Assigning tasks for level ${currentLevel}...`);

//   const nextLevelConfig = botLevels.find(
//     (level) => level.level === currentLevel
//   );
//   if (nextLevelConfig) {
//     console.log(
//       `Assigning tasks for level ${currentLevel}:`,
//       nextLevelConfig.requiredTasks
//     );
//     for (const task of nextLevelConfig.requiredTasks) {
//       try {
//         await addTask(task);
//       } catch (error) {
//         console.error(
//           `Error assigning task ${task.name} for idle state:`,
//           error
//         );
//       }
//     }
//   }
// }
