// Path: src/commands/WhereIs.ts
// Answers "where is ...?" from memory (Phase 5): where it died, the base, its
// bed, crafting tables, furnaces, mines, the chests it knows, or which chest
// holds an item, with how old that knowledge is. Says so when it doesn't know.

import { z } from "zod";
import { reply } from "../core/narrator";
import { loadBed, loadChests, loadDeath, loadDeaths } from "../core/session";
import { getPlaces } from "../managers/persistenceManager";
import { whereStored } from "../actions/storage";
import { ago } from "../actions/perception";

export const description = `Answers where something is, from what the bot remembers: where it died, the base, its bed,
crafting tables, furnaces, mines, the chests it knows, or which chest holds an item. Answers immediately, even while busy.
Examples: "Where did you die?", "Where is the base?", "Where's your bed?", "Where are the chests?",
"Where is the iron?" (what "item"), "Do we have diamonds in a chest?" (what "item").`;

export const parameters = z.object({
  what: z.enum(["death", "base", "bed", "crafting_table", "furnace", "mine", "chests", "item"]).describe("What to find."),
  item_name: z.string().nullable().describe('The item, when what is "item"; null otherwise.'),
});

const at = (p: { x: number; y: number; z: number }): string => `${p.x}, ${p.y}, ${p.z}`;

/** The answer for a question about where something is. Exported for tests. */
export function whereIs(what: z.infer<typeof parameters>["what"], itemName: string | null): string {
  switch (what) {
    case "death": {
      // The death log, not the recovery record (going back for its things clears that)
      const d = loadDeaths().at(-1) ?? loadDeath();
      return d ? `I last died at ${Math.floor(d.x)}, ${Math.floor(d.y)}, ${Math.floor(d.z)} (${d.dimension.replace(/^minecraft:/, "")}), ${ago(d.at)}.` : "I don't remember dying.";
    }
    case "bed": {
      const b = loadBed();
      return b ? `My bed is at ${at(b)}.` : "I don't have a bed of my own yet.";
    }
    case "chests": {
      const chests = loadChests();
      if (chests.length === 0) return "I don't know any chests yet.";
      const list = chests.slice(0, 4).map((c) => `${at(c)} (${c.contents === null ? "never looked inside" : `checked ${ago(c.seenAt)}`})`);
      return `I know ${chests.length} chest${chests.length === 1 ? "" : "s"}: ${list.join("; ")}${chests.length > 4 ? "; ..." : ""}.`;
    }
    case "item": {
      if (!itemName) return "Which item?";
      const found = whereStored(itemName);
      const pretty = itemName.replace(/_/g, " ");
      return found.length > 0 ? `${found.slice(0, 3).join("; ")}.` : `I don't know of any ${pretty} in the chests I've looked in.`;
    }
    default: {
      const places = getPlaces(what);
      const names: Record<string, string> = { base: "base", crafting_table: "crafting table", furnace: "furnace", mine: "mine" };
      if (places.length === 0) return `I don't know where a ${names[what]} is.`;
      const list = places.slice(-3).map((p) => `${p.name && (what === "base" || what === "mine") ? `${p.name} at ` : ""}${at(p)}`);
      if (places.length === 1) return `The ${names[what]} is at ${at(places[0]!)}.`;
      return `I know ${places.length} ${names[what]}s: ${list.join("; ")}${places.length > 3 ? "; ..." : ""}.`;
    }
  }
}

export async function execute(args: unknown): Promise<void> {
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    reply("Where is what?");
    return;
  }
  reply(whereIs(parsed.data.what, parsed.data.item_name));
}
