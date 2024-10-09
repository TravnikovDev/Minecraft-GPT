// Path: src/managers/taskManager.ts

import { v4 as uuidv4 } from "uuid";
import { addActionToQueue } from "./actionManager";
import { getAllActions } from "./persistenceManager";
import { BotTasks } from "../tasks/types";
import { ActionType, TaskType } from "../schemas/types";

// Task List
const tasks: TaskType[] = [];

// Add Task to the Task List
export async function addTask(name: BotTasks, actions: ActionType[]) {
  const taskId = uuidv4();
  const newTask: TaskType = {
    id: taskId,
    name,
    actions,
    status: "pending",
  };
  tasks.push(newTask);
  await addActionsToQueueFromTask(newTask);
  console.log(`Task '${name}' added with ${actions.length} actions.`);

  return taskId;
}

// Add Actions from Task to Queue
async function addActionsToQueueFromTask(task: TaskType) {
  for (const action of task.actions) {
    await addActionToQueue(action.action, action.priority, action.args);
  }
  task.status = "in_progress";
}

// Check Task Completion Status
export function checkTaskCompletion(taskId: TaskType["id"]) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) {
    console.error(`Task with ID ${taskId} not found.`);
    return;
  }

  // Check if all actions for the task are completed
  const remainingActions = getAllActions().filter((action) =>
    task.actions.some((taskAction) => taskAction.action === action.action)
  );

  if (remainingActions.length === 0) {
    task.status = "completed";
    console.log(`Task '${task.name}' is completed.`);
  } else {
    console.log(
      `Task '${task.name}' is still in progress. Remaining actions: ${remainingActions.length}`
    );
  }
}

// Get All Tasks
export function getAllTasks() {
  return tasks;
}
