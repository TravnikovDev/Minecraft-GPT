// Path: src/managers/toolManager.ts

import { commandRegistry, availableCommands } from "../commands/registry";
import { BotCommands } from "../commands/types";

const tools = [...availableCommands];

// Export tools to be used with OpenAI for validation purposes
export { tools };

// Centralized function to execute a tool command
export async function executeTool(command: string, args: any) {
  console.log(`Executing tool command ${command}`);

  const commandModule = commandRegistry[command as BotCommands];
  if (commandModule) {
    await commandModule.execute(args);
  } else {
    console.error(`Error: command ${command} not found in registry.`);
  }
}
