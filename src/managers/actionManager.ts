// Path: src/managers/actionManager.ts

import {
  removeAction,
  getAllActions,
  addActionToQueue,
} from "./persistenceManager";
import { executeTool } from "./toolManager";
import type { ActionType } from "../schemas/types";

// Process an Action
async function processAction(nextAction: ActionType) {
  try {
    await executeTool(nextAction.action, nextAction.args);
  } catch (error) {
    console.error(`Error executing action ${nextAction.action}:`, error);
    // Fallback mechanism: re-add action to the queue with lower priority for retry
    await addActionToQueue(nextAction);
    console.log(
      `Re-added action ${nextAction.action} to queue with lower priority for retry.`
    );
  } finally {
    try {
      await removeAction(nextAction.id);
    } catch (error) {
      console.error(
        `Error removing action ${nextAction.id} from queue:`,
        error
      );
    }
  }
}

// Execute Actions in Queue
export async function executeActions() {
  const actions = await getAllActions();
  console.log("- Executing actions in queue...");

  if (actions.length === 0) {
    console.log("- No actions in queue. Attempting idle tasks...");
    // await handleIdleState();
    return;
  }

  actions.sort((a, b) => a.priority - b.priority);
  for (const action of actions) {
    try {
      console.log(
        `- Executing action ${action.action} with priority ${action.priority}`
      );
      await processAction(action);
    } catch (error) {
      console.error("Error executing actions:", error);
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
