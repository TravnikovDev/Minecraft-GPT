// Path: src/managers/actionManager.ts

import { BotActions } from "../actions/types";
import { addAction, removeAction, getAllActions } from "./persistenceManager";
import { executeTool } from "./toolManager";
import { v4 as uuidv4 } from "uuid";
import { addTask } from "./taskManager";
import { BotProgress } from "./botProgress";
import { botLevels } from "../progress/botLevels";
import { ActionSchema } from "../schemas/mainSchemas";

// Add Action to Queue
export async function addActionToQueue(
  action: BotActions,
  priority: number,
  args: any
) {
  try {
    // Validate action and priority before adding to queue
    ActionSchema.parse({ action, priority });
    const actionId = uuidv4();
    await addAction({ id: actionId, action, args, priority });
    console.log(`Added action ${action} with priority ${priority} to queue.`);
  } catch (error) {
    console.error("Error adding action to queue:", error);
  }
}

// Process an Action
async function processAction(actionId: string, action: BotActions, args: any) {
  try {
    await executeTool(action, args);
  } catch (error) {
    console.error(`Error executing action ${action}:`, error);
    // Fallback mechanism: re-add action to the queue with lower priority for retry
    await addActionToQueue(action, 10, args);
    console.log(
      `Re-added action ${action} to queue with lower priority for retry.`
    );
  } finally {
    try {
      await removeAction(actionId);
    } catch (error) {
      console.error(`Error removing action ${actionId} from queue:`, error);
    }
  }
}

// Execute Actions in Queue
export async function executeActions() {
  const actions = await getAllActions();
  console.log("Executing actions in queue:", actions);

  if (actions.length === 0) {
    console.log("No actions in queue. Attempting idle tasks...");
    await handleIdleState();
    return;
  }

  actions.sort((a, b) => a.priority - b.priority);
  for (const action of actions) {
    try {
      console.log(
        `Executing action ${action.action} with priority ${action.priority}`
      );
      console.log("Action args:", action.args);
      console.log(action);
      await processAction(action.id, action.action as BotActions, action.args);
    } catch (error) {
      console.error("Error executing actions:", error);
    }
  }
}

// Add Action Based on Event
export async function addActionFromEvent(
  action: BotActions,
  priority: number,
  args: any = {}
) {
  try {
    await addActionToQueue(action, priority, args);
  } catch (error) {
    console.error("Error adding action from event:", error);
  }
}

// Handle Idle State by assigning tasks based on bot progress
async function handleIdleState() {
  const botProgress = new BotProgress();
  const currentLevel = botProgress.getCurrentLevel();
  console.log(`Bot is idle. Assigning tasks for level ${currentLevel}...`);

  const nextLevelConfig = botLevels.find(
    (level) => level.level === currentLevel
  );
  if (nextLevelConfig) {
    console.log(
      `Assigning tasks for level ${currentLevel}:`,
      nextLevelConfig.requiredTasks
    );
    for (const task of nextLevelConfig.requiredTasks) {
      try {
        await addTask(task.name, task.actions);
      } catch (error) {
        console.error(
          `Error assigning task ${task.name} for idle state:`,
          error
        );
      }
    }
  }
}
