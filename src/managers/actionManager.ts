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
  try {
    await executeTool(nextCommand.command, nextCommand.args);
  } catch (error) {
    console.error(`Error executing command ${nextCommand.command}:`, error);
    // Fallback mechanism: re-add command to the queue with lower priority for retry
    await addCommandToQueue(nextCommand);
    console.log(
      `Re-added command ${nextCommand.command} to queue with lower priority for retry.`
    );
  } finally {
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
