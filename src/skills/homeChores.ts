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

/**
 * What it carries put away in its chests at home (owner: keep things in the
 * shelter, not on it): all but its working kit (tools and armour, its food,
 * torches, 32 cobblestone, 16 dirt, 16 coal, sticks, a few logs) and
 * precious things. Raw iron stays while it has no iron pickaxe (it's for
 * that). In its shelter first. How many it put away.
 */
export async function putAwayHaul(): Promise<number> {
  const { enterShelter } = await import("../actions/building");
  const home = await enterShelter();
  if (!home.ok || isCommandCancelled()) return 0;
  const { toolTier, TIER } = await import("../skills/capabilities");
  // Its seeds stay on it for its fields (owner: they sat in its chests while the fields stood bare)
  const { SEED_NAMES } = await import("./farm");
  const keep = [...SEED_NAMES, ...(toolTier("pickaxe") < TIER.iron ? ["raw_iron"] : [])];
  const { storeItems } = await import("../actions/storage");
  const stored = await storeItems("half", [], keep);
  const n = stored ? [...stored.stored.values()].reduce((a, b) => a + b, 0) : 0;
  if (n > 0) report(`Put ${n} things away in my chests at home.`);
  if (stored?.problem) console.log(`Home: couldn't put everything away (${stored.problem}).`);
  else if (stored && stored.leftOver.size > 0) console.log(`Home: my chests are full; ${[...stored.leftOver.values()].reduce((a, b) => a + b, 0)} things stay on me.`);
  return n;
}

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

  // Raw iron first into an iron pickaxe if it has none (storing would put
  // the raw iron away first and the pickaxe step found none: review)
  const { toolTier: tier0, TIER: T0 } = await import("../skills/capabilities");
  const rawIronNow = bot.inventory.items().filter((i) => i.name === "raw_iron").reduce((n, i) => n + i.count, 0);
  if (rawIronNow > 0 && tier0("pickaxe") < T0.iron) {
    const { smeltIronAndMakePickaxe } = await import("../skills/milestones");
    const made = await smeltIronAndMakePickaxe();
    if (!made.ok) console.log(`Home: no iron pickaxe yet (${describeFailure(made)}).`);
  }
  if (isCommandCancelled()) return fail("aborted", "stopped");

  // Cheap stuff and half of the valuable things in the chests (it keeps its working supply)
  const { storeItems } = await import("../actions/storage");
  const stored = await storeItems("half");
  if (stored?.problem) problems.push(`couldn't put things away (${stored.problem})`);
  if (isCommandCancelled()) return fail("aborted", "stopped");
  // Its food stock from its chests (cooked first; raw is cooked below), review
  await (await import("../skills/milestones")).foodFromChests();
  // Stair blocks for its mine's bare steps, made here at the table (never a climb home for them)
  try {
    await (await import("../skills/mine")).makeStairBlocks();
  } catch (error) {
    console.log(`Home: stair blocks failed: ${(error as Error).message}`);
  }

  // Raw meat in the furnace, loaded and left: the chores below go on while
  // it cooks (owner: not standing by the furnace), collected between tasks
  const { cookFood, rawFoodInInventory } = await import("../actions/cooking");
  if (rawFoodInInventory().length > 0) {
    const cooked = await cookFood(null, 64, true);
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
