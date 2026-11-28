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
import { MILESTONES, heldBy, milestoneHere } from "../skills/milestones";
import { foodPoints, shelter, TIER, toolTier } from "../skills/capabilities";
import { liveWorld } from "../skills/world";
import { forbiddenAt } from "../core/forbidden";
import { fitForTheMine, myMine } from "../skills/mine";
import { farmRipe, myFarms } from "../skills/farm";
import { isGame, knownAnimals } from "../actions/hunting";
import { smeltedFrom } from "../skills/techTree";
import { oreCapped } from "../skills/oreCaps";
import { storedNear } from "../actions/storage";
import { daylight } from "../core/daylight";
import { needsDaylight, worksInTheMine } from "./names";
import { fishingWaterNear } from "../skills/fishing";

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
  /**
   * Ready right where it stands when the step starts (never checked when the
   * plan is made: "explore, then hunt" must stay a plan): animals known,
   * water in reach, fit for the mine. Not ready: the step is skipped with
   * why, which is no failure and costs no new plan.
   */
  ready?: (args: Record<string, unknown>) => Feasible;
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
  // ... and its tier open: the safety order holds for the plan too (review)
  return here.filter((m) => !done.has(m.id) && (m.requires ?? []).every(doneAnywhere) && heldBy(m).length === 0).map((m) => m.id);
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
    if (noWay.length > 0) return no(`no way to get ${noWay.map((m) => words(m.name)).join(", ")}`);
    // What it's made of comes from deep down (gold, redstone, diamonds): the
    // diamonds milestone's safety order holds for a craft too (what its
    // chests hold already is no trip down)
    return deepHeld(plan.missing.filter((m) => storedNear(m.name) < m.count).map((m) => m.name));
  } catch (error) {
    return no(`couldn't work out how to make it (${(error as Error).message})`);
  }
}

const MINEABLE = ["coal", "raw_iron", "diamond", "cobblestone"] as const;
const PICKAXE_FOR: Record<string, number> = { coal: TIER.stone, raw_iron: TIER.stone, diamond: TIER.iron, cobblestone: TIER.wooden };

/**
 * What holds a trip down for `item` back: diamonds are deep (lava, more
 * mobs), so the diamonds milestone's safety order holds for a plain trip
 * down too (review). Empty for the rest.
 */
function heldFor(item: string): string[] {
  if (item !== "diamond") return [];
  const diamonds = MILESTONES.find((m) => m.id === "diamonds");
  return diamonds ? heldBy(diamonds) : [];
}

// Ores its own mine can reach, by the item they give. Deep ones (lava, more
// mobs) wait for the diamonds milestone's safety order, like diamonds
const MINE_ORE_ITEMS = new Set(["coal", "raw_iron", "raw_copper", "raw_gold", "redstone", "lapis_lazuli", "diamond", "emerald"]);
const DEEP_ORE_ITEMS = new Set(["raw_gold", "redstone", "lapis_lazuli", "diamond", "emerald"]);

/** The deep ore an item is, or is smelted from ("gold_ingot" -> "raw_gold"), or null. Pure. */
export function deepOreBehind(item: string): string | null {
  if (DEEP_ORE_ITEMS.has(item)) return item;
  const raw = smeltedFrom(item);
  return raw && DEEP_ORE_ITEMS.has(raw) ? raw : null;
}

/**
 * Whether getting these materials would send it deep down before the
 * diamonds milestone's safety order is met (a shield, a water bucket, iron
 * armour): the deep ores among them, and what's smelted from one.
 */
function deepHeld(materials: string[]): Feasible {
  const deep = [...new Set(materials.map(deepOreBehind).filter((m): m is string => m !== null))];
  if (deep.length === 0) return yes;
  const held = heldFor("diamond");
  return held.length ? no(`${deep.map(words).join(", ")} is deep down: ${held.map(words).join(", ")} first`) : yes;
}

/**
 * Whether `item` can be collected: a real item with a source the item
 * planner knows (its chests, gravel, sheep, an ore of its mine, the
 * furnace); deep ores (and what's smelted from them) only once the diamonds
 * milestone's safety order is met; an ore it has its fill of (copper) not at all.
 */
function collectable(item: string, count: number): Feasible {
  if (!catalog().isItem(item)) return no(`"${item}" isn't a Minecraft item`);
  const isOre = catalog().oresFor(item).length > 0;
  if (isOre && !MINE_ORE_ITEMS.has(item)) return no(`${words(item)} isn't found in its mine`);
  try {
    const raw = smeltedFrom(item) ?? item;
    // Its fill of an ore: mining leaves the rest in the walls (skills/oreCaps)
    if (oreCapped(raw)) return no(`it has its fill of ${words(raw)}; more is left in the walls`);
    // (enough of it in its chests already is no trip down)
    const deep = storedNear(item) >= count ? yes : deepHeld([item]);
    if (!deep.ok) return deep;
    return liveWorld.sources.some((src) => src.gets(item)) ? yes : no(`it knows no place ${words(item)} comes from (craftable things: use craft)`);
  } catch (error) {
    return no(`couldn't work out where ${words(item)} comes from (${(error as Error).message})`);
  }
}

/** The animals it hunts, as the plan names them. */
export const GAME_ANIMAL_NAMES = ["cow", "pig", "sheep", "chicken", "rabbit"] as const;
// What a hunt brings in (to tell a hunt that got something from one that found none)
const HUNT_DROPS = /^(beef|porkchop|mutton|chicken|rabbit|leather|feather|rabbit_hide|rabbit_foot|.*_wool)$/;
const carriedDrops = (): number => (bot.inventory?.items() ?? []).filter((i) => HUNT_DROPS.test(i.name)).reduce((n, i) => n + i.count, 0);

/** The animals it knows are about now, by kind ("3 cow, 2 sheep"), for the menu. */
function animalsKnown(): string {
  if (!bot.entity) return "";
  const counts = new Map<string, number>();
  for (const p of knownAnimals()) if (isGame(p, null)) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  return [...counts.entries()].map(([name, n]) => `${n} ${name}`).join(", ");
}

/** A rod it carries, or the 2 string to make one. */
const canFish = (): boolean => {
  const have = (name: string): number => (bot.inventory?.items() ?? []).filter((i) => i.name === name).reduce((n, i) => n + i.count, 0);
  return have("fishing_rod") > 0 || have("string") >= 2;
};

export { needsDaylight, worksInTheMine };

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
      if (missing.length) return no(`${m.title} needs ${missing.join(", ")} first`);
      // The safety order: an earlier tier's milestones first (a shield, a
      // bucket and armour before diamonds or the Nether, review)
      const held = heldBy(m);
      return held.length ? no(`${m.title} waits for ${held.map(words).join(", ")} first`) : yes;
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
      const held = heldFor(item);
      return held.length ? no(`${words(item)} waits for ${held.map(words).join(", ")} first`) : yes;
    },
    menu: () => {
      const tier = toolTier("pickaxe");
      const can = MINEABLE.filter((i) => tier >= (PICKAXE_FOR[i] ?? TIER.stone) && heldFor(i).length === 0);
      if (can.length === 0) return "not yet: no pickaxe";
      // A diamond gear milestone mines exactly what its piece takes: better
      // than a guessed count here
      const gear = can.includes("diamond") ? " (for diamond gear plan its milestone instead: it mines the diamonds the piece takes)" : "";
      return `possible for: ${can.join(", ")}${gear}`;
    },
    // The plan's count is what it should carry, not that many more (game
    // test: with 17 raw iron, "mining for 12 raw iron" went for 29)
    run: async (a) => {
      const { mineFor, carriedFor } = await import("../skills/mine");
      const item = String(a["item"]);
      const missing = Number(a["count"]) - carriedFor(item);
      if (missing <= 0) return ok();
      if (item !== "coal") return mineFor(item, missing);
      // Coal: the same as the coal milestone (skills/coalDrought): charcoal
      // when its mine has been dry of it and wood is plenty; otherwise a mine
      // trip, counted dry or not (game test: the plan's coal step went
      // straight down the mine, past the charcoal fallback)
      const { makeCharcoalNow, makeCharcoal, coalTripStart, coalTripEnd } = await import("../skills/coalDrought");
      if (makeCharcoalNow()) {
        const made = await makeCharcoal(missing);
        if (made.ok) return made;
      }
      const start = coalTripStart();
      try {
        return await mineFor(item, missing);
      } finally {
        await coalTripEnd(start);
      }
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
  {
    name: "tendFarm",
    about: "look after its fields: harvest what's ripe, sow the bare ground again, mend the plot, bake the wheat into bread",
    args: z.object({}),
    feasible: () => (myFarms().length > 0 ? yes : no("it has no field yet (the farm milestone makes the first)")),
    menu: () => {
      const n = myFarms().length;
      return n > 0 ? `possible (${n} field${n === 1 ? "" : "s"}, ${farmRipe()} ripe crops in sight)` : "not yet: no field";
    },
    run: async () => {
      const { tendFarm } = await import("../skills/farm");
      await tendFarm();
      return ok(); // nothing ripe yet is no failure: the field was sown and mended
    },
    describe: () => "looking after my fields",
  },
  {
    name: "goFishing",
    about: "fish for food by day from the shore of open water within 24 blocks (with a fishing rod it carries, or makes from 3 sticks and 2 string)",
    args: z.object({}),
    feasible: () => (canFish() ? yes : no("it has no fishing rod, and not the 2 string to make one")),
    menu: () => (canFish() ? "possible by day (it has a rod or the string for one)" : "not now: no fishing rod, and no 2 string to make one"),
    // By daylight (the step waits for it) and with water in reach of where it stands then
    ready: () => (!daylight() ? no("it's dark; fishing is for the day") : (fishingWaterNear() ? yes : no("no open water with a shore within 24 blocks of here"))),
    run: async () => {
      const { goFishing } = await import("../skills/fishing");
      return (await goFishing()) > 0 ? ok() : fail("not_found", "caught no fish (no open water with a shore within 24 blocks, it got dark, or mobs came close)");
    },
    describe: () => "fishing for food",
  },
  {
    name: "hunt",
    about: "hunt one kind of animal for its meat and drops (cow: beef and leather for armour; sheep: mutton and wool; chicken: chicken and feathers; pig; rabbit), never babies or named pets; it walks to ones it knows of up to 200 blocks away",
    args: z.object({ animal: z.enum(GAME_ANIMAL_NAMES), count: z.number().int().min(1).max(8) }),
    defaults: { count: 3 },
    feasible: () => yes,
    menu: () => `possible once that animal is about; animals it knows of now: ${animalsKnown() || "none (explore for animals first)"}`,
    // None of that kind known when the step starts: skipped, not walked out for and failed
    ready: (a) => (knownAnimals().some((p) => isGame(p, String(a["animal"]))) ? yes : no(`no ${String(a["animal"])} it could take is known within 200 blocks`)),
    run: async (a) => {
      const animal = String(a["animal"]);
      const before = carriedDrops();
      // Loaded when used: the command modules reach back to the registry
      const { execute: hunt } = await import("../commands/Hunting");
      await hunt({ maxDistance: 60, mobType: animal, count: Number(a["count"]), upTo: null, walkFar: true });
      return carriedDrops() > before ? ok() : fail("not_found", `found no ${animal} to take within 200 blocks`);
    },
    describe: (a) => `hunting ${String(a["animal"])} (up to ${String(a["count"])})`,
  },
  {
    name: "collect",
    about: "get a raw material from where it comes from, its chests first: flint (gravel), wool (sheep), another ore's item from its mine (raw_copper, raw_gold, redstone, lapis_lazuli), or something smelted (iron_ingot, stone, smooth_stone, glass, charcoal), until it carries `count`",
    args: z.object({ item: z.string(), count: z.number().int().min(1).max(64) }),
    defaults: { count: 4 },
    feasible: (a) => collectable(String(a["item"]), Number(a["count"] ?? 1)),
    menu: () => "any item with a source it knows (things with a recipe: use craft)",
    run: async (a) => {
      const { acquire } = await import("../skills/acquire");
      const { liveWorld } = await import("../skills/world");
      return acquire(String(a["item"]), Number(a["count"]), liveWorld);
    },
    describe: (a) => `collecting ${String(a["count"])} ${words(String(a["item"]))}`,
  },
  {
    name: "mendMine",
    about: "go over its mine like at the start of a mining trip: fill the holes in its stairs' floor, walls and roof, clear what fell into them, light the dark stretches, block the ways in from caves and from outside, mine the ores its tunnels uncovered",
    args: z.object({}),
    feasible: () => (!myMine() ? no("it has no mine yet") : toolTier("pickaxe") < TIER.stone ? no("its mine is worked with a stone pickaxe, and it has none") : yes),
    menu: () => (!myMine() ? "not yet: no mine" : toolTier("pickaxe") < TIER.stone ? "not now: no stone pickaxe" : "possible (it has a mine)"),
    // Hurt or with too little food it stays out of its mine, like a mining trip (skills/mine fitForTheMine)
    ready: () => {
      const fit = fitForTheMine(bot.health ?? 20, foodPoints());
      return fit.ok ? yes : no(fit.detail);
    },
    run: async () => {
      const mine = await import("../skills/mine");
      const left = await mine.lookAfterStairs();
      await mine.lookAfterFloors();
      return left === 0 ? ok() : fail("missing_items", `${left} hole${left === 1 ? "" : "s"} in my mine stairs still open (nothing to fill them with, or no way to them)`);
    },
    describe: () => "mending my mine",
  },
];

// Goals that work in its mine, and the milestones that do
// (the diamond gear milestones mine the diamonds a piece takes when it has too few)
const MINE_MILESTONES = new Set(["mine", "coal", "iron", "diamonds", "paved_stairs", "diamond_pickaxe", "diamond_sword", "diamond_chestplate", "diamond_armor"]);

/**
 * The owner's and the server's rules for a step (the validator's policy
 * check): never work where it must keep out. Its mine or its shelter inside
 * a keep-out area means no step that goes there.
 */
export function policy(goal: string, args: Record<string, unknown>): Feasible {
  const mine = myMine();
  const usesMine = worksInTheMine(goal) || (goal === "reachMilestone" && MINE_MILESTONES.has(String(args["milestone"])));
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
