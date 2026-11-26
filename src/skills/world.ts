// Path: src/skills/world.ts
// The live game behind acquire (skills/acquire.ts): what it carries, the craft
// planner, crafting, and the sources of raw materials (trees, stone, sheep,
// coal). Kept apart so the planner itself can be tested with a fake world.

import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { fail, ok, type ActionResult } from "../core/result";
import { craftNow, planCraft } from "../actions/craftPlanner";
import { gatherWood } from "../actions/gatherWood";
import type { AcquireWorld, Source } from "./acquire";
import { carried, hasTableAccess, TIER, toolTier } from "./capabilities";
import { storedNear } from "../actions/storage";
import { pickaxeFor, smeltedFrom, STANDS_IN_FOR } from "./techTree";
import { daylight } from "../core/daylight";

/** True when every recipe for the item needs a crafting table (3x3). */
function needsTable(item: string): boolean {
  const id = bot.registry.itemsByName[item]?.id;
  if (id === undefined) return false;
  const recipes = bot.recipesAll(id, null, true) as { requiresTable?: boolean }[];
  return recipes.length > 0 && recipes.every((r) => r.requiresTable);
}

const got = (before: number, after: number, what: string): ActionResult => (after > before ? ok() : fail("missing_items", `found no ${what}`));

/** Where raw materials come from, in the order they're tried. */
export const SOURCES: Source[] = [
  {
    // What its own chests hold (ones it placed, or in its shelter; never the
    // owner's) comes first, like a player: it lost its
    // pickaxes and wanted cobblestone for new ones, with a pile of it at
    // home, and "didn't know how to get cobblestone"
    name: "taking from my chests",
    gets: (m) => storedNear(m) > 0,
    run: async (m, count) => {
      const before = carried(m);
      const { takeItems } = await import("../actions/storage");
      await takeItems([{ name: m, count }], true);
      return got(before, carried(m), `${m.replace(/_/g, " ")} in my chests`);
    },
  },
  {
    name: "chopping trees",
    collects: true,
    gets: (m) => m === "logs" || catalog().isLog(m),
    run: async (_m, count) => {
      // Trees are out in the open: not after sunset (night work, a torch or
      // a shield made at home, mustn't walk it out to a forest: review)
      if (!daylight()) {
        return fail("refused", "it's night; the trees wait for the morning");
      }
      const before = carried("logs");
      await gatherWood(Math.max(count, 2), 64);
      return got(before, carried("logs"), "trees");
    },
  },
  {
    name: "mining stone",
    collects: true,
    gets: (m) => m === "cobblestone",
    // A pickaxe first (any: wood mines stone)
    needs: () => (toolTier("pickaxe") >= TIER.wooden ? [] : [{ item: "wooden_pickaxe", count: 1 }]),
    run: async (_m, count) => {
      const before = carried("cobblestone");
      // The owner's rules (skills/mine mineFor): in sight, the first mine
      // stairs, or the mine; never a hole wherever it stands
      const { mineFor } = await import("./mine");
      await mineFor("cobblestone", count);
      return got(before, carried("cobblestone"), "stone");
    },
  },
  {
    // Flint drops from gravel now and then (a player digs gravel until it does)
    name: "breaking gravel",
    collects: true,
    gets: (m) => m === "flint",
    run: async (_m, count) => {
      const before = carried("flint");
      const { collectBlock } = await import("../actions/collectBlock");
      // About one in ten gravel gives flint; a few rounds of digging
      for (let round = 0; round < 4 && carried("flint") < before + count; round++) {
        if ((await collectBlock("gravel", 8, 32)) === 0) break;
      }
      return got(before, carried("flint"), "flint in the gravel");
    },
  },
  {
    name: "hunting sheep",
    collects: true,
    gets: (m) => /_wool$/.test(m),
    needs: () => (toolTier("sword") >= TIER.wooden ? [] : [{ item: "wooden_sword", count: 1 }]),
    run: async (_m, count) => {
      const allWool = (): number => bot.inventory.items().filter((i) => /_wool$/.test(i.name)).reduce((n, i) => n + i.count, 0);
      const before = allWool();
      // None near the shelter any more: look farther first
      const { exploreFor, inSight } = await import("./explore");
      await exploreFor("sheep", () => inSight((n) => n === "sheep"));
      // An explicit count: a general hunt leaves two of each kind to breed
      // Loaded when used: the command modules reach back to the registry, which reaches here
      const { execute: hunt } = await import("../commands/Hunting");
      await hunt({ maxDistance: 60, mobType: "sheep", count: Math.max(1, count), walkFar: null });
      // Any colour counts (the bed takes whichever it has 3 of); wool it already had doesn't
      return allWool() > before ? ok() : fail("missing_items", "found no sheep");
    },
  },
  {
    // Any ore, with the pickaxe the game requires for it (iron: stone, diamond: iron)
    name: "mining ores",
    collects: true,
    gets: (m) => m !== "cobblestone" && catalog().oresFor(m).length > 0,
    needs: (m) => {
      const pickaxe = pickaxeFor(m, catalog());
      return pickaxe && toolTier("pickaxe") < catalog().toolTier(pickaxe) ? [{ item: pickaxe, count: 1 }] : [];
    },
    run: async (m, count) => {
      const before = carried(m);
      // In sight, or down its mine with a stone pickaxe (skills/mine mineFor)
      const { mineFor } = await import("./mine");
      await mineFor(m, count);
      return got(before, carried(m), m.replace(/_/g, " "));
    },
  },
  {
    // A furnace: ingots, glass, stone; and charcoal from logs when there's no
    // coal to mine (tried after mining, so coal ore nearby still wins)
    name: "smelting",
    gets: (m) => smeltedFrom(m) !== null || STANDS_IN_FOR["charcoal"] === m,
    needs: (m, count) => {
      const out = smeltedFrom(m) ? m : "charcoal";
      const input = smeltedFrom(out)!;
      const needs = furnaceNear() ? [] : [{ item: "furnace", count: 1 }];
      // Fuel when it has none: a log makes planks for 6 smelts; logs burn 1.5 each
      const fuelLogs = hasFuel(input) ? 0 : input === "logs" ? Math.ceil(count / 6) : Math.ceil(count / 1.5);
      if (input === "logs") return [...needs, { item: "logs", count: count + fuelLogs }];
      return [...needs, { item: input, count }, ...(fuelLogs ? [{ item: "logs", count: fuelLogs }] : [])];
    },
    run: async (m, count) => {
      const out = smeltedFrom(m) ? m : "charcoal";
      let input = smeltedFrom(out)!;
      const before = carried(out);
      if (input === "logs") {
        // The log type it has most of; a log of it made into planks for fuel
        const logs = bot.inventory.items().filter((i) => catalog().isLog(i.name)).sort((a, b) => b.count - a.count);
        if (!logs[0]) return fail("missing_items", "no logs to make charcoal");
        input = logs[0].name;
        const planks = catalog().planksFor(input);
        if (!hasFuel(input) && planks) await craftNow(planks, 4 * Math.ceil(count / 6));
      }
      const { smelt } = await import("../actions/cooking");
      const made = await smelt(input, count);
      if (made === null) return fail("missing_items", "no furnace or no fuel");
      return got(before, carried(out), out.replace(/_/g, " "));
    },
  },
];

/** A furnace carried or within 24 blocks. */
function furnaceNear(): boolean {
  if (carried("furnace") > 0) return true;
  const id = bot.registry.blocksByName["furnace"]?.id;
  return id !== undefined && bot.findBlock({ matching: id, maxDistance: 24 }) !== null;
}

/** Fuel it carries other than `input` itself: coal, charcoal, planks, or a different log. */
function hasFuel(input: string): boolean {
  return bot.inventory.items().some((i) => i.name !== input && (/^(coal|charcoal)$/.test(i.name) || catalog().isPlanks(i.name) || (input !== "logs" && catalog().isLog(i.name))));
}

/** acquire() in the live game. */
export const liveWorld: AcquireWorld = {
  // Charcoal counts as coal (torches, campfires, fuel take either)
  have: (item) => carried(item) + Object.entries(STANDS_IN_FOR).reduce((n, [alt, main]) => (main === item ? n + carried(alt) : n), 0),
  plan: (item, count) => {
    // `count` more than it carries (the plan counts what's carried as made)
    const plan = planCraft(item, carried(item) + count);
    return { missing: plan.missing, needsTable: plan.steps.some((s) => needsTable(s.name)) };
  },
  craft: async (item, count) => (await craftNow(item, count)).ok,
  tableAccess: () => hasTableAccess(),
  sources: SOURCES,
};
