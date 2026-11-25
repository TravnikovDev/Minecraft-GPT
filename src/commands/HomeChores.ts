// Path: src/commands/HomeChores.ts
// Home after a death (or when asked): with a shelter and a bed of its own it
// has a home to go back to, like a player, instead of trailing the owner
// (owner: go to the bed, put goods in storage, cook food, make pickaxes).

import { z } from "zod";
import { bot } from "../core/body";
import { describeFailure } from "../core/result";
import { report } from "../core/narrator";
import { isCommandCancelled } from "../core/commandContext";

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
  const { enterShelter } = await import("../actions/building");
  const { shelter, toolTier, TIER } = await import("../skills/capabilities");
  if (!shelter()) {
    report("I have no shelter to go home to yet.");
    return;
  }
  const home = await enterShelter();
  if (isCommandCancelled()) return;
  if (!home.ok) {
    report(`I couldn't get home: ${describeFailure(home)}.`);
    return;
  }
  report("Home. Putting things away, cooking and checking my tools.");
  // What didn't work, said at the end (never a plain "done" when it wasn't)
  const problems: string[] = [];

  // Cheap stuff in the chests (it keeps its working supply)
  const { storeItems } = await import("../actions/storage");
  const stored = await storeItems("lowValue");
  if (stored?.problem) problems.push(`couldn't put things away (${stored.problem})`);
  if (isCommandCancelled()) return;

  // Raw meat in the furnace
  const { cookFood, rawFoodInInventory } = await import("../actions/cooking");
  if (rawFoodInInventory().length > 0) {
    const cooked = await cookFood();
    if (cooked !== null && cooked > 0) report(`Cooked ${cooked} food.`);
    else if (cooked === null) problems.push("no furnace or fuel to cook my raw food");
  }
  if (isCommandCancelled()) return;

  // Tools: raw iron becomes an iron pickaxe; otherwise at least stone ones
  const { acquire } = await import("../skills/acquire");
  const { liveWorld } = await import("../skills/world");
  const rawIron = bot.inventory.items().filter((i) => i.name === "raw_iron").reduce((n, i) => n + i.count, 0);
  if (rawIron > 0 && toolTier("pickaxe") < TIER.iron) {
    const { smeltIronAndMakePickaxe } = await import("../skills/milestones");
    const made = await smeltIronAndMakePickaxe();
    if (!made.ok) problems.push(`no iron pickaxe yet (${describeFailure(made)})`);
  }
  for (const [kind, item] of [["pickaxe", "stone_pickaxe"], ["sword", "stone_sword"]] as const) {
    if (isCommandCancelled()) return;
    if (toolTier(kind) >= TIER.stone) continue;
    const made = await acquire(item, 1, liveWorld);
    if (!made.ok) problems.push(`no ${item.replace(/_/g, " ")} (${describeFailure(made)})`);
  }
  report(problems.length === 0 ? "Done at home." : `Done at home, except: ${problems.join("; ")}.`);
}
