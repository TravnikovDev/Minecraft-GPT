// Path: src/planner/goals.ts
// The goal vocabulary of a day plan (Phase 7): what the model may ask the
// bot to do, at the level a player plans a day ("get iron tools", "stock
// food", "tidy up at home"), never a single block or step. Each goal says in
// code whether it can be done now (the feasible-goal menu the model gets) and
// runs through the skills that already exist, returning a typed result for
// the diary.

import { z } from "zod";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { describeFailure, fail, ok, type ActionResult } from "../core/result";
import { MILESTONES, milestoneHere } from "../skills/milestones";
import { shelter, TIER, toolTier } from "../skills/capabilities";
import { liveWorld } from "../skills/world";
import { forbiddenAt } from "../core/forbidden";
import { myMine } from "../skills/mine";

/** A goal's check: possible now, or why not. */
export type Feasible = { ok: true } | { ok: false; why: string };

export type Goal = {
  name: string;
  /** For the model: what it does, in one line. */
  about: string;
  /** Its arguments (strict: every field present, nullable when optional). */
  args: z.ZodObject<z.ZodRawShape>;
  /** What an argument the model left out (null) means (it often leaves counts out). */
  defaults?: Record<string, unknown>;
  /** Possible now with these arguments (checked again when the step starts). */
  feasible: (args: Record<string, unknown>) => Feasible;
  /** What can be asked of it right now, for the menu ("open milestones: coal, iron"). */
  menu: () => string;
  /** Does it. */
  run: (args: Record<string, unknown>) => Promise<ActionResult>;
  /** For chat and the diary: "get stone tools". */
  describe: (args: Record<string, unknown>) => string;
};

const yes: Feasible = { ok: true };
const no = (why: string): Feasible => ({ ok: false, why });
const words = (s: string): string => s.replace(/_/g, " ");

/** Milestones that can be worked on now: not done, everything they need done first. */
export function openMilestones(): string[] {
  // Only those that can be worked on in this dimension (milestoneHere)
  const here = MILESTONES.filter(milestoneHere);
  const done = new Set(here.filter((m) => m.done()).map((m) => m.id));
  const doneAnywhere = (id: string): boolean => done.has(id) || (MILESTONES.find((m) => m.id === id)?.dimension === "any" ? false : !here.some((m) => m.id === id));
  return here.filter((m) => !done.has(m.id) && (m.requires ?? []).every(doneAnywhere)).map((m) => m.id);
}

/**
 * Whether the item planner (skills/acquire) has a way to every raw material
 * a craft still needs: the recipe tree from what it carries, then a source
 * for each missing material. Without one ("a nether star"), the step is
 * left out with the material it can't get.
 */
function craftable(item: string, count: number): Feasible {
  try {
    const plan = liveWorld.plan(item, count);
    const noWay = plan.missing.filter((m) => !liveWorld.sources.some((src) => src.gets(m.name)));
    return noWay.length === 0 ? yes : no(`no way to get ${noWay.map((m) => words(m.name)).join(", ")}`);
  } catch (error) {
    return no(`couldn't work out how to make it (${(error as Error).message})`);
  }
}

const MINEABLE = ["coal", "raw_iron", "diamond", "cobblestone"] as const;
const PICKAXE_FOR: Record<string, number> = { coal: TIER.stone, raw_iron: TIER.stone, diamond: TIER.iron, cobblestone: TIER.wooden };

export const GOALS: Goal[] = [
  {
    name: "reachMilestone",
    about: "work towards a progression milestone (tools, shelter, mine, iron, diamonds...)",
    args: z.object({ milestone: z.enum(MILESTONES.map((m) => m.id) as [string, ...string[]]) }),
    feasible: (a) => {
      const m = MILESTONES.find((x) => x.id === a["milestone"]);
      if (!m) return no(`no milestone "${String(a["milestone"])}"`);
      if (m.done()) return no(`${m.title} is done already`);
      const missing = (m.requires ?? []).filter((r) => !MILESTONES.find((x) => x.id === r)?.done());
      return missing.length ? no(`${m.title} needs ${missing.join(", ")} first`) : yes;
    },
    menu: () => `open milestones now: ${openMilestones().join(", ") || "none (all done)"}`,
    run: async (a) => {
      const m = MILESTONES.find((x) => x.id === a["milestone"]);
      return m ? m.achieve() : fail("not_found", `no milestone "${String(a["milestone"])}"`);
    },
    // "the iron milestone", "the lit home milestone" (not "the a lit home milestone")
    describe: (a) => `the ${words(String(MILESTONES.find((x) => x.id === a["milestone"])?.title ?? a["milestone"])).replace(/^(a|an) /, "")} milestone`,
  },
  {
    name: "stockFood",
    about: "hunt and pick berries until it carries a couple of days' food, cooking raw meat",
    args: z.object({}),
    feasible: () => yes,
    menu: () => "always possible",
    run: async () => {
      const food = MILESTONES.find((m) => m.id === "food");
      return food ? food.achieve() : fail("not_found", "no food routine");
    },
    describe: () => "stocking food",
  },
  {
    name: "restAndRepair",
    about: "go home: mend the shelter, put cheap things in the chests, cook, smelt, replace missing tools",
    args: z.object({}),
    feasible: () => (shelter() ? yes : no("it has no shelter yet")),
    menu: () => (shelter() ? "possible (it has a shelter)" : "not yet: no shelter"),
    run: async () => {
      const { buildShelter, shelterIntact } = await import("../actions/building");
      const mended = shelterIntact() ? ok() : await buildShelter();
      const { homeChores } = await import("../skills/homeChores");
      const chores = await homeChores();
      if (!mended.ok) return fail(mended.reason, `my shelter isn't mended (${describeFailure(mended)})${chores.ok ? "" : `; ${describeFailure(chores)}`}`);
      return chores;
    },
    describe: () => "resting and tidying up at home",
  },
  {
    name: "gatherWood",
    about: "chop trees for logs",
    args: z.object({ count: z.number().int().min(4).max(64) }),
    defaults: { count: 16 },
    feasible: () => yes,
    menu: () => "always possible (4 to 64 logs)",
    run: async (a) => {
      const { gatherWood } = await import("../actions/gatherWood");
      return (await gatherWood(Number(a["count"]))) ? ok() : fail("missing_items", "couldn't get all the logs");
    },
    describe: (a) => `chopping ${String(a["count"])} logs`,
  },
  {
    name: "mineFor",
    about: "go down its mine for coal, raw iron, diamonds or cobblestone until it carries `count` of it (what it carries already counts)",
    args: z.object({ item: z.enum(MINEABLE), count: z.number().int().min(1).max(64) }),
    defaults: { count: 10 },
    feasible: (a) => {
      const item = String(a["item"]);
      const need = PICKAXE_FOR[item] ?? TIER.stone;
      if (toolTier("pickaxe") < need) return no(`${words(item)} needs a ${need >= TIER.iron ? "iron" : need >= TIER.stone ? "stone" : "wooden"} pickaxe`);
      return yes;
    },
    menu: () => {
      const tier = toolTier("pickaxe");
      const can = MINEABLE.filter((i) => tier >= (PICKAXE_FOR[i] ?? TIER.stone));
      return can.length ? `possible for: ${can.join(", ")}` : "not yet: no pickaxe";
    },
    // The plan's count is what it should carry, not that many more (game
    // test: with 17 raw iron, "mining for 12 raw iron" went for 29)
    run: async (a) => {
      const { mineFor, carriedFor } = await import("../skills/mine");
      const item = String(a["item"]);
      const missing = Number(a["count"]) - carriedFor(item);
      if (missing <= 0) return ok();
      return mineFor(item, missing);
    },
    describe: (a) => `mining for ${String(a["count"])} ${words(String(a["item"]))}`,
  },
  {
    name: "craft",
    about: "make an item, getting the materials, a table and tools first (exact Minecraft id, e.g. torch, bread, iron_sword)",
    args: z.object({ item: z.string(), count: z.number().int().min(1).max(64) }),
    defaults: { count: 1 },
    feasible: (a) => {
      const item = String(a["item"]);
      if (!catalog().isItem(item)) return no(`"${item}" isn't a Minecraft item`);
      const id = bot.registry?.itemsByName[item]?.id;
      const recipes = id === undefined ? [] : (bot.recipesAll?.(id, null, true) ?? []);
      if (recipes.length === 0) return no(`${words(item)} can't be crafted`);
      // Every raw material the recipe tree still needs must have a way to get
      // it (trees, the mine, sheep, smelting, its chests), as acquire would
      return craftable(item, Number(a["count"] ?? 1));
    },
    menu: () => "any craftable item",
    run: async (a) => {
      const { acquire } = await import("../skills/acquire");
      const { liveWorld } = await import("../skills/world");
      return acquire(String(a["item"]), Number(a["count"]), liveWorld);
    },
    describe: (a) => `making ${String(a["count"])} ${words(String(a["item"]))}`,
  },
  {
    name: "explore",
    about: "walk off in a direction it hasn't tried lately, looking for animals or sheep",
    args: z.object({ lookFor: z.enum(["animals", "sheep"]) }),
    defaults: { lookFor: "animals" },
    feasible: () => yes,
    menu: () => "always possible",
    run: async (a) => {
      const { animalsInSight, exploreFor, inSight } = await import("../skills/explore");
      const sheep = (): boolean => inSight((n) => n === "sheep");
      const found = await exploreFor(String(a["lookFor"]), a["lookFor"] === "sheep" ? sheep : animalsInSight);
      return found ? ok() : fail("not_found", `found no ${String(a["lookFor"])}`);
    },
    describe: (a) => `exploring for ${String(a["lookFor"])}`,
  },
  {
    name: "plantTrees",
    about: "plant saplings it carries around its base (keeps wood growing)",
    args: z.object({}),
    feasible: () => (bot.inventory?.items().some((i) => i.name.endsWith("_sapling")) ? yes : no("it carries no saplings")),
    menu: () => (bot.inventory?.items().some((i) => i.name.endsWith("_sapling")) ? "possible (it carries saplings)" : "not now: no saplings"),
    run: async () => {
      const { plantSaplings } = await import("../actions/forestry");
      const home = shelter();
      const { Vec3 } = await import("vec3");
      const planted = await plantSaplings(home ? new Vec3(home.x, home.y, home.z) : null, null, 8);
      const n = [...planted.values()].reduce((a, b) => a + b, 0);
      return n > 0 ? ok() : fail("not_found", "found nowhere to plant");
    },
    describe: () => "planting trees",
  },
];

// Goals that work in its mine, and the milestones that do
const MINE_MILESTONES = new Set(["mine", "coal", "iron", "diamonds", "paved_stairs"]);

/**
 * The owner's and the server's rules for a step (the validator's policy
 * check): never work where it must keep out. Its mine or its shelter inside
 * a keep-out area means no step that goes there.
 */
export function policy(goal: string, args: Record<string, unknown>): Feasible {
  const mine = myMine();
  const usesMine = goal === "mineFor" || (goal === "reachMilestone" && MINE_MILESTONES.has(String(args["milestone"])));
  if (usesMine && mine) {
    const area = forbiddenAt(mine.start) ?? forbiddenAt(mine.bottom);
    if (area) return no(`my mine is in a keep-out area (${area.reason})`);
  }
  const home = shelter();
  if (goal === "restAndRepair" && home) {
    const area = forbiddenAt(home);
    if (area) return no(`my shelter is in a keep-out area (${area.reason})`);
  }
  return yes;
}

/** A goal by name. */
export const goalNamed = (name: string): Goal | undefined => GOALS.find((g) => g.name === name);

/** The feasible-goal menu for the model: each goal, what it does, and what's possible now. */
export function goalMenu(): string {
  return GOALS.map((g) => `- ${g.name}: ${g.about}. Now: ${g.menu()}.`).join("\n");
}
