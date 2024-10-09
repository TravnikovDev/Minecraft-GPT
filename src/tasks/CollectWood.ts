// Path: src/tasks/CollectWood.ts

import { addTask } from "../managers/taskManager";
import { BotActions } from "../actions/types";
import { z } from "zod";
import { BotTasks } from "./types";

// Define parameters for the CollectWood task
export const parameters = z.object({
  woodType: z.string().describe("The type of wood to collect."),
  amount: z.number().describe("The number of wood blocks to collect."),
});

// Implement the CollectWood task
export async function execute(args: any) {
  console.log(`Executing CollectWood task with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(
      `Missing parameters for CollectWood: woodType or amount is undefined.`
    );
    return;
  }

  const { woodType, amount } = parsed.data;

  try {
    // Define actions for the CollectWood task
    const actions = [
      {
        id: "action1",
        action: BotActions.GoToNearestBlock,
        priority: 5,
        args: { blockType: woodType, minDistance: 2, range: 64 },
      },
      //   {
      //     id: "action2",
      //     action: BotActions.CollectBlocks,
      //     priority: 5,
      //     args: { blockType: woodType, num: amount },
      //   },
    ];

    // Add task to the task manager
    await addTask(BotTasks.CollectWood, actions);
    console.log(`Task 'CollectWood' added with ${actions.length} actions.`);
  } catch (error) {
    console.error("Error executing CollectWood task:", error);
  }
}
