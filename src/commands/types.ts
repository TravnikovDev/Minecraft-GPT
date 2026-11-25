// Path: src/commands/types.ts
// The command names, taken from the one list in ./all.ts. Only types are
// imported from it: command modules import this file, so a runtime import
// would close a cycle (commands -> types -> all -> commands).

import type * as All from "./all";

/** A command's key in ./all.ts (its module name): "GoToPlayer". */
export type CommandKey = keyof typeof All;

/** A command's name, as chat and the model use it: "goToPlayer". */
type BotCommands = Uncapitalize<CommandKey>;

/**
 * The name of a command from its key, so `BotCommands.GoToPlayer` is
 * "goToPlayer". It can't be listed (`Object.values` is empty): the registry
 * (commands/registry) is the list to go through.
 */
const BotCommands = new Proxy({} as { readonly [K in CommandKey]: Uncapitalize<K> }, {
  get: (_target, key) => (typeof key === "string" ? key.charAt(0).toLowerCase() + key.slice(1) : undefined),
});

export { BotCommands };
