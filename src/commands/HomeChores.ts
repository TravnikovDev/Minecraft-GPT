// Path: src/commands/HomeChores.ts
// Home after a death (or when asked): with a shelter and a bed of its own it
// has a home to go back to, like a player, instead of trailing the owner
// (owner: go to the bed, put goods in storage, cook food, make pickaxes).

import { z } from "zod";
import { describeFailure } from "../core/result";
import { report } from "../core/narrator";

export const description = `Goes home to its shelter and does the chores there: puts cheap things in its chests,
cooks raw food in its furnace, smelts raw iron, and makes a pickaxe and a sword if it has none. It does this on its
own after getting its things back from where it died, once it has a shelter and a bed.
Example: "Go home and tidy up", "Go home and cook", "Do your chores at home".`;

export const parameters = z.object({});

/** True when it has a home to go back to: a shelter and a bed. */
export async function hasHome(): Promise<boolean> {
  const { shelter, hasBed } = await import("../skills/capabilities");
  return shelter() !== null && hasBed();
}

export async function execute(): Promise<void> {
  const { homeChores } = await import("../skills/homeChores");
  const result = await homeChores();
  if (result.ok) report("Done at home.");
  else if (result.reason !== "aborted") report(`Done at home, except: ${describeFailure(result)}.`);
}
