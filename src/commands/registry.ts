// Path: src/commands/registry.ts

import { zodFunction } from "openai/helpers/zod";
import * as All from "./all";

import { BotCommands } from "./types";

type CommandModule = {
  parameters: any;
  execute: (args: any) => Promise<void>;
  description: string;
};

// Every command from the one list (./all.ts), by name: "goToPlayer" -> its module
export const commandRegistry = Object.fromEntries(
  Object.entries(All).map(([key, module]) => [key.charAt(0).toLowerCase() + key.slice(1), module as CommandModule])
) as Record<BotCommands, CommandModule>;

/** True for the name of a command the bot has. */
export function isBotAction(action: string): action is BotCommands {
  return Object.prototype.hasOwnProperty.call(commandRegistry, action);
}

// Extracting tools for use with validation (zodFunction)
export const availableCommands = Object.entries(commandRegistry).map(
  ([commandName, command]) =>
    zodFunction({
      name: commandName,
      parameters: command.parameters,
      description: command.description,
    })
);
