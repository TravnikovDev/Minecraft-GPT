// Path: src/managers/actionManager.ts

import { addAction, removeAction, getAllActions } from "./persistenceManager";
import { BotActions } from "./actionTypes";
import { executeTool } from "./toolManager";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

// Define action validation schema
const actionSchema = z.object({
  action: z.nativeEnum(BotActions),
  args: z.any(),
  priority: z.number().min(1).max(10),
});

// Add Action to Queue
export async function addActionToQueue(
  action: BotActions,
  priority: number,
  args: any
) {
  try {
    // Validate action and priority before adding to queue
    actionSchema.parse({ action, priority });
    const actionId = uuidv4();
    await addAction(actionId, action, args, priority);
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
