// Path: src/commands/SetBasement.ts
// The owner asking for its shelter, or for a spot for it: the same shelter
// its own life makes (owner, 2026-11-28: "make them the same"), the
// standard room and stairs its mine is planned from, at a spot it looks for
// itself: underground, then the most ore its mine will reach. With a shelter
// already, it's checked and mended. "Set base here" (SetBase) is the one
// that builds where the owner stands.

import { z } from "zod";
import { describeFailure } from "../core/result";
import { report } from "../core/narrator";

export const description = `Finds a spot for the bot's home and digs its underground shelter there (a diagonal
tunnel down to a room), the same shelter it makes on its own: it looks round for a good place first (biome, trees,
animals, a dry way down for its mine, underground, and the most ore its mine will reach). With a shelter already, it
checks it and mends it. Use this for finding a home spot too. Example: "Build a shelter", "Set up a basement",
"Search a spot for the shelter", "Find a place for our home".`;

export const parameters = z.object({});

export async function execute(): Promise<void> {
  const { buildShelter } = await import("../actions/building");
  const result = await buildShelter();
  if (result.ok) report("My shelter is ready.");
  else if (result.reason !== "aborted") report(`No shelter yet: ${describeFailure(result)}.`);
}
