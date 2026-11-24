// Path: src/core/commandContext.ts
// Which command is running and whether it was cancelled. Kept free of other
// imports so actions and commands can read it without importing the command
// runner (which imports every command, and would create an import cycle).

import { AsyncLocalStorage } from "node:async_hooks";

// Each command runs with its own abort signal in async context, so code that
// keeps running after its command was cancelled still sees the cancellation.
const commandSignal = new AsyncLocalStorage<AbortSignal>();
let currentCommandName: string | null = null;

/** Runs a command's code with its abort signal attached to the async context. */
export function runWithSignal<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  return commandSignal.run(signal, fn);
}

/**
 * True when the command this code is running for has been cancelled.
 * Long-running actions (loops that search, gather or wait) should check this
 * and return early.
 */
export function isCommandCancelled(): boolean {
  return commandSignal.getStore()?.aborted ?? false;
}

/** Name of the command currently running, or null when idle. */
export function getCurrentCommandName(): string | null {
  return currentCommandName;
}

/** Called by the command runner when a command starts or ends. */
export function setCurrentCommandName(name: string | null): void {
  currentCommandName = name;
}
