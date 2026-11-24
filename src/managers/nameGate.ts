// Path: src/managers/nameGate.ts
// Checks item, block and mob names from the LLM at the gateway, before a
// command is queued (architecture: names are validated where they enter, not
// deep inside an action). A real name passes, normalised ("Torches" ->
// torch). A generic name a command understands ("bed", "planks", "iron
// armor") passes as is. Anything else gets a short clarifying question with
// the closest real names, instead of the bot guessing or searching for air.

import { catalog, type Catalog, type Kind } from "../core/catalog";
import { BotCommands } from "../commands/types";

type Check = {
  field: string;
  kind: Kind;
  /** Extra names this command understands besides exact IDs. */
  allow?: (name: string, c: Catalog) => boolean;
};

// "bed", "planks", "helmet", "boat": a kind of item many IDs end with
const isGenericItem = (name: string, c: Catalog): boolean => {
  const one = name.replace(/s$/, "");
  return c.suggest(name, "item", 50).some((n) => n.endsWith(`_${name}`) || n.endsWith(`_${one}`));
};
// "armor", "iron armor", "stone tools", "set of diamond armor" (CraftItem builds the set)
const isEquipmentSet = (name: string): boolean => /^(full_)?(set_of_)?([a-z]+_)?(armou?rs?|tools)(_set)?$/.test(name);
// "diamonds", "coal", "raw_iron": items that come from mining ores
const comesFromOre = (name: string, c: Catalog): boolean => {
  const item = c.validate(name, "item");
  return item.ok && c.oresFor(item.name).length > 0;
};

const CHECKS: Partial<Record<BotCommands, Check[]>> = {
  [BotCommands.CollectBlocks]: [{ field: "blockType", kind: "block", allow: comesFromOre }],
  [BotCommands.GoToBlock]: [{ field: "blockType", kind: "block" }],
  [BotCommands.CraftItem]: [{ field: "itemName", kind: "item", allow: (n, c) => isEquipmentSet(n) || isGenericItem(n, c) }],
  [BotCommands.PlaceItem]: [{ field: "itemName", kind: "item", allow: isGenericItem }],
  [BotCommands.Cook]: [{ field: "itemName", kind: "item" }],
  [BotCommands.Hunting]: [{ field: "mobType", kind: "entity" }],
  [BotCommands.AttackNearest]: [{ field: "mobType", kind: "entity" }],
};

/** "a, b or c" with chat-friendly names. */
function orList(names: string[], c: Catalog): string {
  const shown = names.map((n) => c.display(n).toLowerCase());
  return shown.length < 2 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} or ${shown.at(-1)}`;
}

/**
 * Checks (and normalises, in place) the names in a command's arguments.
 * Returns null when they're fine, or the question to ask the owner.
 */
export function checkNames(command: string, args: Record<string, unknown>): string | null {
  const checks = CHECKS[command as BotCommands];
  if (!checks) return null;
  const c = catalog();
  for (const { field, kind, allow } of checks) {
    const value = args[field];
    if (typeof value !== "string" || value.trim() === "") continue; // null means "any"
    const result = c.validate(value, kind);
    if (result.ok) {
      args[field] = result.name;
      continue;
    }
    if (allow?.(result.input, c)) {
      args[field] = result.input;
      continue;
    }
    const what = kind === "entity" ? "mob" : kind;
    const pretty = result.input.replace(/_/g, " ");
    return result.suggestions.length > 0
      ? `I don't know the ${what} "${pretty}". Did you mean ${orList(result.suggestions, c)}?`
      : `I don't know the ${what} "${pretty}".`;
  }
  return null;
}
