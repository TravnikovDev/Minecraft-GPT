// Path: src/actions/registry.ts

import { zodFunction } from "openai/helpers/zod";
import * as CollectWood from "./CollectWood";

import { BotTasks } from "./types";

type TaskModule = {
  parameters: any;
  execute: (args: any) => Promise<void>;
};

// Creating an action registry by using the filename as a key
export const tasksRegistry: Record<BotTasks, TaskModule> = {
  [BotTasks.CollectWood]: CollectWood,
};

// Extracting tools for use with validation (zodFunction)
export const availableTasks = Object.entries(tasksRegistry).map(
  ([taskName, task]) =>
    zodFunction({
      name: taskName,
      parameters: task.parameters,
    })
);
