// Path: src/managers/taskManager.ts

import { v4 as uuidv4 } from "uuid";
import { addActionToQueue } from "./actionManager";
import { BotActions } from "../actions/types";
import { getAllActions } from "./persistenceManager";

// Define Task Schema
type Task = {
  id: string;
  name: string;
  actions: { action: BotActions; priority: number; args: any }[];
  status: "pending" | "in_progress" | "completed";
};

// Task List
const tasks: Task[] = [];

// Add Task to the Task List
export async function addTask(
  name: string,
  actions: { action: BotActions; priority: number; args: any }[]
) {
  const taskId = uuidv4();
  const newTask: Task = {
    id: taskId,
    name,
    actions,
    status: "pending",
  };
  tasks.push(newTask);
  await addActionsToQueueFromTask(newTask);
  console.log(`Task '${name}' added with ${actions.length} actions.`);
}

// Add Actions from Task to Queue
async function addActionsToQueueFromTask(task: Task) {
  for (const action of task.actions) {
    await addActionToQueue(action.action, action.priority, action.args);
  }
  task.status = "in_progress";
}

// Check Task Completion Status
export function checkTaskCompletion(taskId: string) {
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
