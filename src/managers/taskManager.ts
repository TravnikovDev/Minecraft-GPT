// Path: src/managers/taskManager.ts

import { addActionToQueue, getAllActions } from "./persistenceManager";
import { TaskType } from "../schemas/types";

// Task List
const tasks: TaskType[] = [];

// Add Task to the Task List
export async function addTask(newTask: TaskType): Promise<TaskType["id"]> {
  tasks.push(newTask);
  await addActionsToQueueFromTask(newTask.actions);
  console.log(
    `Task '${newTask.name}' added with ${newTask.actions.length} actions.`
  );

  return newTask.id;
}

// Add Multiple Tasks to the Task List
export async function addManyTasks(
  newTasks: TaskType[]
): Promise<TaskType["id"][]> {
  const taskIds = [];
  for (const task of newTasks) {
    const taskId = await addTask(task);
    taskIds.push(taskId);
  }
  return taskIds;
}

// Add Actions from Task to Queue
async function addActionsToQueueFromTask(actions: TaskType["actions"]) {
  for (const action of actions) {
    await addActionToQueue(action);
  }
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
