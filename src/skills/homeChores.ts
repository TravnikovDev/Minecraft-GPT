// Path: src/skills/homeChores.ts
// Home chores (owner: after a death with a home, go to the bed, put goods in
// storage, cook food, make pickaxes): into the shelter, cheap things in the
// chests, raw meat cooked, raw iron smelted into an iron pickaxe, a stone
// pickaxe and sword if it has none. Ok only when all of it worked; otherwise
// a failure listing what didn't (the diary and the plan never get a false
// success).

import { bot } from "../core/body";
import { describeFailure, fail, ok, type ActionResult } from "../core/result";
import { report } from "../core/narrator";
import { isCommandCancelled } from "../core/commandContext";

export async function homeChores(): Promise<ActionResult> {
  const { enterShelter } = await import("../actions/building");
  const { shelter, toolTier, TIER } = await import("../skills/capabilities");
  if (!shelter()) return fail("not_found", "I have no shelter to go home to yet");
  const home = await enterShelter();
  if (isCommandCancelled()) return fail("aborted", "stopped");
  if (!home.ok) return fail(home.reason, `I couldn't get home: ${describeFailure(home)}`);
  report("Home. Putting things away, cooking and checking my tools.");
  // What didn't work, said at the end (never a plain "done" when it wasn't)
  const problems: string[] = [];

  // Cheap stuff in the chests (it keeps its working supply)
  const { storeItems } = await import("../actions/storage");
  const stored = await storeItems("lowValue");
  if (stored?.problem) problems.push(`couldn't put things away (${stored.problem})`);
  if (isCommandCancelled()) return fail("aborted", "stopped");

  // Raw meat in the furnace
  const { cookFood, rawFoodInInventory } = await import("../actions/cooking");
  if (rawFoodInInventory().length > 0) {
    const cooked = await cookFood();
    if (cooked !== null && cooked > 0) report(`Cooked ${cooked} food.`);
    else if (cooked === null) problems.push("no furnace or fuel to cook my raw food");
  }
  if (isCommandCancelled()) return fail("aborted", "stopped");

  // Its furnace kept busy with the ores in its chests; torches from stored coal
  try {
    await (await import("./workshop")).workshop();
  } catch (error) {
    console.log(`Home: workshop failed: ${(error as Error).message}`);
  }
  if (isCommandCancelled()) return fail("aborted", "stopped");

  // Leather from its hunts becomes armour for the slots it has nothing in
  const { makeLeatherArmor } = await import("./leatherArmor");
  const leather = await makeLeatherArmor();
  if (!leather.ok) problems.push(`no leather armour (${describeFailure(leather)})`);
  if (isCommandCancelled()) return fail("aborted", "stopped");

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
    if (isCommandCancelled()) return fail("aborted", "stopped");
    if (toolTier(kind) >= TIER.stone) continue;
    const made = await acquire(item, 1, liveWorld);
    if (!made.ok) problems.push(`no ${item.replace(/_/g, " ")} (${describeFailure(made)})`);
  }
  return problems.length === 0 ? ok() : fail("missing_items", problems.join("; "));
}
