// Path: src/managers/toolManager.ts

import { tools, actionRegistry } from "../actions/registry";
import { BotActions } from "../actions/types";

// Export tools to be used with OpenAI for validation purposes
export { tools };

// Centralized function to execute a tool action
export async function executeTool(action: string, args: any) {
  console.log(`Executing tool action ${action} with args:`, args);

  // Validate that args contain the expected properties
  if (!args) {
    console.error(`Error: Arguments for action ${action} are undefined.`);
    return;
  }

  const actionModule = actionRegistry[action as BotActions];
  if (actionModule) {
    await actionModule.execute(args);
  } else {
    console.error(`Error: Action ${action} not found in registry.`);
  }
}
