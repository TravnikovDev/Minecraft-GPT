// Path: src/skills/workshop.ts
// Keeping its home furnace busy, like a player (owner: check the chests now
// and then and smelt the ores; craft better blocks or things once a resource
// piles up). A furnace smelts on its own, so it's loaded and left: each
// visit takes out what's done, puts in the next batch from its chests (raw
// ores first; sand into glass and cobblestone into stone once they pile up)
// and fuel for it, and goes. And torches are made from stored coal when its
// torches run low.

import pf from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { bot } from "../core/body";
import type { Block } from "prismarine-block";
import type { Furnace } from "mineflayer";
import { goTo, knownBlock } from "../core/primitives";
import { fail, ok, type ActionResult } from "../core/result";
import { isCommandCancelled } from "../core/commandContext";
import { chatter } from "../core/narrator";

// What it smelts, first first: raw ores always; the rest only past a pile
export const SMELT_JOBS: Array<{ input: string; output: string; above: number }> = [
  { input: "raw_iron", output: "iron_ingot", above: 0 },
  { input: "raw_gold", output: "gold_ingot", above: 0 },
  { input: "raw_copper", output: "copper_ingot", above: 0 },
  // Smooth stone for its shelter's walls (stone smelted again; only while it's wanted, see tendFurnace)
  { input: "stone", output: "smooth_stone", above: 0 },
  { input: "sand", output: "glass", above: 32 },
  { input: "cobblestone", output: "stone", above: 256 },
];
// A batch: at most a stack; one coal (or charcoal) smelts 8
const BATCH = 64;
const PER_FUEL = 8;
// Items a plank smelts
const PER_PLANK = 1.5;

/** The planks it has most of (carried or stored), as the fuel to burn: "jungle_planks". */
function woodPlanksName(): string {
  const items = bot.inventory.items().filter((i) => i.name.endsWith("_planks")).sort((a, b) => b.count - a.count);
  if (items[0]) return items[0].name;
  const log = bot.inventory.items().find((i) => i.name.endsWith("_log"));
  return log ? log.name.replace(/_log$/, "_planks") : "oak_planks";
}

/** Planks made from the logs it carries beyond its 20-log stock (best effort). */
async function makePlanks(want: number): Promise<void> {
  const { acquire } = await import("./acquire");
  const { liveWorld } = await import("./world");
  const name = woodPlanksName();
  await acquire(name, carried(name) + want, liveWorld);
}
// Torches kept on hand and in its chests
const TORCH_STOCK = 32;
// What it keeps carrying for its own work: the workshop never takes the
// carried stock below this (review: it burned the coal it carried, the coal
// milestone reopened and sent it down the mine; it smelted the cobblestone
// it keeps for plugs and floors)
const KEEP_CARRIED: Record<string, number> = { coal: 16, charcoal: 16, cobblestone: 32 };
// Milestones that use iron: raw iron stays out of the furnace while one is open (it smelts it itself)
const IRON_MILESTONES = ["iron_pickaxe", "iron_sword", "shield", "bucket", "iron_armor", "iron_tools"];

/** What to put in the furnace next, from what it has (carried and stored): the first job with something past its pile. Pure. */
export function pickSmeltJob(
  have: (name: string) => number,
  pileOf: (job: (typeof SMELT_JOBS)[number]) => number = (job) => job.above
): { input: string; output: string; count: number } | null {
  for (const job of SMELT_JOBS) {
    const spare = have(job.input) - pileOf(job);
    if (spare > 0) return { input: job.input, output: job.output, count: Math.min(BATCH, spare) };
  }
  return null;
}

const carried = (name: string): number => bot.inventory.items().filter((i) => i.name === name).reduce((n, i) => n + i.count, 0);
/** What it carries beyond what it keeps for its own work. */
const spare = (name: string): number => Math.max(0, carried(name) - (KEEP_CARRIED[name] ?? 0));

/**
 * Brings `want` spare of `name` from its chests: what it keeps carrying is
 * topped up first, so chest stock is spare on top of it.
 */
async function fetchSpare(name: string, want: number): Promise<void> {
  const short = want - spare(name);
  if (short <= 0) return;
  const { takeItems } = await import("../actions/storage");
  await takeItems([{ name, count: short + Math.max(0, (KEEP_CARRIED[name] ?? 0) - carried(name)) }], true);
}

/**
 * How much more smooth stone its shelter's weak walls want, with coal
 * enough to make it (two stacks, owner); 0 when none.
 */
async function smoothStoneWanted(): Promise<number> {
  const { owned, REINFORCE_COAL } = await import("./milestones");
  if (owned(["coal"]) < REINFORCE_COAL) return 0;
  const { shelterWeakCells } = await import("./reinforce");
  return Math.max(0, shelterWeakCells().length - owned(["smooth_stone"]));
}

/** Its home furnace (the block), or null. */
async function homeFurnace(): Promise<Block | null> {
  const { shelterSlots } = await import("../actions/building");
  const spot = shelterSlots()?.furnace;
  const furnace = spot ? knownBlock(new Vec3(spot.x, spot.y, spot.z)) : null;
  return furnace?.name === "furnace" ? furnace : null;
}

/** Opens its home furnace (walking there); null when it can't. */
async function openHome(furnace: Block): Promise<Furnace | null> {
  const p = furnace.position;
  if (!(await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 2))).ok) return null;
  const { openFurnaceAt } = await import("../core/containers");
  const opened = await openFurnaceAt(furnace);
  return opened.ok ? opened.value : null;
}

/**
 * Takes `names` (done or still waiting) out of its home furnace: iron a
 * milestone needs is fetched from there before a trip down for more
 * (review). How many it took.
 */
export async function takeFromHomeFurnace(names: string[]): Promise<number> {
  const furnace = await homeFurnace();
  if (!furnace) return 0;
  const window = await openHome(furnace);
  if (!window) return 0;
  const { closeWindow, windowStep } = await import("../core/containers");
  let took = 0;
  try {
    const out = window.outputItem();
    if (out && names.includes(out.name) && (await windowStep("taking out what's done", () => window.takeOutput())).ok) took += out.count;
    const input = window.inputItem();
    if (input && names.includes(input.name) && (await windowStep("taking out what's waiting", () => window.takeInput())).ok) took += input.count;
  } finally {
    closeWindow(window);
  }
  return took;
}

/**
 * One visit to its home furnace: what's done taken out, the next batch and
 * fuel (from its chests, and what it carries beyond its own stock) put in,
 * left smelting. What it did, or why not.
 */
export async function tendFurnace(): Promise<ActionResult<string>> {
  const furnace = await homeFurnace();
  if (!furnace) return fail("not_found", "no furnace at home");
  const { closeWindow, windowStep } = await import("../core/containers");
  const done: string[] = [];
  // First a look: what's done comes out; a furnace still busy is left to it
  // (nothing fetched from the chests for it, review)
  let window = await openHome(furnace);
  if (!window) return fail("unreachable", "can't get to my furnace");
  let busy = false;
  let fueled = false;
  try {
    const out = window.outputItem();
    if (out && (await windowStep("taking out what's done", () => window!.takeOutput())).ok) done.push(`took out ${out.count} ${out.name.replace(/_/g, " ")}`);
    busy = window.inputItem() !== null;
    fueled = window.fuelItem() !== null;
  } finally {
    closeWindow(window);
  }
  if (busy) return ok(done.concat("the furnace is still busy").join("; "));
  const { storedNear } = await import("../actions/storage");
  const { MILESTONES } = await import("./milestones");
  const ironOpen = MILESTONES.some((m) => IRON_MILESTONES.includes(m.id) && !m.done());
  // Smooth stone its shelter still needs (owner: only with two stacks of
  // coal): stone smelted into it, and cobblestone into stone past a small
  // pile instead of 256
  const smooth = await smoothStoneWanted();
  const have = (name: string): number => {
    if (name === "raw_iron" && ironOpen) return 0;
    const n = spare(name) + storedNear(name, 32);
    return name === "stone" ? Math.min(n, smooth) : n;
  };
  const job = pickSmeltJob(have, (j) => (j.input === "cobblestone" && smooth > 0 ? 0 : j.above));
  if (!job) return ok(done.concat("nothing to smelt").join("; "));
  // The batch from the chests (what it carries beyond its stock counts too)
  if (storedNear(job.input, 32) > 0) await fetchSpare(job.input, job.count);
  const n = Math.min(spare(job.input), job.count);
  if (n === 0) return ok(done.concat("nothing to smelt").join("; "));
  // With a lot of wood about, planks burn and the coal is kept for torches
  // (owner); else coal, then charcoal
  const { woodPlenty, woodNow } = await import("../actions/fuel");
  const planksName = woodPlenty(woodNow()) ? woodPlanksName() : null;
  const fuelNeeded = fueled ? 0 : Math.ceil(n / (planksName ? PER_PLANK : PER_FUEL));
  const fuelName = planksName ?? (storedNear("coal", 32) + spare("coal") >= fuelNeeded ? "coal" : "charcoal");
  if (fuelNeeded > 0 && storedNear(fuelName, 32) > 0 && spare(fuelName) < fuelNeeded) await fetchSpare(fuelName, fuelNeeded);
  if (fuelNeeded > 0 && planksName && spare(fuelName) < fuelNeeded) await makePlanks(fuelNeeded - spare(fuelName));
  if (fuelNeeded > 0 && spare(fuelName) === 0) return ok(done.concat("no spare fuel").join("; "));
  if (isCommandCancelled()) return fail("aborted", "stopped");
  window = await openHome(furnace);
  if (!window) return fail("unreachable", "can't get to my furnace");
  try {
    if (window.inputItem()) return ok(done.concat("the furnace is busy now").join("; "));
    if (!window.fuelItem()) {
      const put = await windowStep("fuelling", () => window!.putFuel(bot.registry.itemsByName[fuelName]!.id, null, Math.min(spare(fuelName), Math.ceil(n / (planksName ? PER_PLANK : PER_FUEL)))));
      if (!put.ok) return put;
    }
    const loaded = await windowStep(`putting ${job.input} in`, () => window!.putInput(bot.registry.itemsByName[job.input]!.id, null, Math.min(n, spare(job.input))));
    if (!loaded.ok) return loaded;
    done.push(`left ${n} ${job.input.replace(/_/g, " ")} smelting into ${job.output.replace(/_/g, " ")}`);
  } finally {
    closeWindow(window);
  }
  return ok(done.join("; "));
}

/**
 * Torches made from coal it doesn't need for its own stock (stored, or
 * carried beyond it) when its torches run low, only as many as the coal and
 * the wood it has make: never a trip out or down for more (review: asking
 * for 32 torches with 2 coal sent it mining from inside its night routine).
 */
export async function topUpTorches(): Promise<void> {
  const { storedNear } = await import("../actions/storage");
  const torches = carried("torch") + storedNear("torch", 32);
  if (torches >= TORCH_STOCK) return;
  const coalWanted = Math.ceil((TORCH_STOCK - torches) / 4);
  if (storedNear("coal", 32) > 0) await fetchSpare("coal", coalWanted);
  const { catalog } = await import("../core/catalog");
  const items = bot.inventory.items();
  const planks = items.filter((i) => i.name.endsWith("_planks")).reduce((n, i) => n + i.count, 0);
  const logs = items.filter((i) => catalog().isLog(i.name)).reduce((n, i) => n + i.count, 0);
  const sticks = carried("stick") + 2 * planks + 8 * logs;
  const make = Math.min(TORCH_STOCK - torches, 4 * (spare("coal") + spare("charcoal")), 4 * sticks);
  if (make < 4) return;
  const { acquire } = await import("./acquire");
  const { liveWorld } = await import("./world");
  if ((await acquire("torch", carried("torch") + make, liveWorld)).ok) console.log(`Workshop: made torches (${carried("torch")} carried).`);
}
/** The workshop round: the furnace tended, torches topped up. Says what it did. */
export async function workshop(): Promise<void> {
  const furnace = await tendFurnace();
  if (furnace.ok && furnace.value && !/^(nothing to smelt|the furnace is still busy)$/.test(furnace.value)) chatter(`Workshop: ${furnace.value}.`, "workshop");
  else if (!furnace.ok) console.log(`Workshop: ${furnace.ok ? "" : furnace.detail}.`);
  if (!isCommandCancelled()) await topUpTorches();
}
