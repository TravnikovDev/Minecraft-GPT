// Path: src/tasks/types.ts

// Define an enum for available bot tasks
enum BotTasks {
  CollectWood = "collectWood",
}

// Type guard to check if a value is a valid BotTasks
function isBotTask(action: string): action is BotTasks {
  return Object.values(BotTasks).includes(action as BotTasks);
}

export { BotTasks, isBotTask };
