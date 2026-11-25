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
import { fail, ok, type ActionResult } from "../core/result";
import { MILESTONES } from "../skills/milestones";
import { shelter, TIER, toolTier } from "../skills/capabilities";

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
  const done = new Set(MILESTONES.filter((m) => m.done()).map((m) => m.id));
  return MILESTONES.filter((m) => !done.has(m.id) && (m.requires ?? []).every((r) => done.has(r))).map((m) => m.id);
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
    describe: (a) => `the ${words(String(MILESTONES.find((x) => x.id === a["milestone"])?.title ?? a["milestone"]))} milestone`,
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
      if (!shelterIntact()) await buildShelter();
      const { execute } = await import("../commands/HomeChores");
      await execute();
      return ok();
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
    about: "go down its mine for coal, raw iron, diamonds or cobblestone",
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
    run: async (a) => {
      const { mineFor } = await import("../skills/mine");
      return mineFor(String(a["item"]), Number(a["count"]));
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
      return recipes.length > 0 ? yes : no(`${words(item)} can't be crafted`);
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

/** A goal by name. */
export const goalNamed = (name: string): Goal | undefined => GOALS.find((g) => g.name === name);

/** The feasible-goal menu for the model: each goal, what it does, and what's possible now. */
export function goalMenu(): string {
  return GOALS.map((g) => `- ${g.name}: ${g.about}. Now: ${g.menu()}.`).join("\n");
}
