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
import { goTo, knownBlock } from "../core/primitives";
import { fail, ok, type ActionResult } from "../core/result";
import { isCommandCancelled } from "../core/commandContext";
import { chatter } from "../core/narrator";

// What it smelts, first first: raw ores always; the rest only past a pile
export const SMELT_JOBS: Array<{ input: string; output: string; above: number }> = [
  { input: "raw_iron", output: "iron_ingot", above: 0 },
  { input: "raw_gold", output: "gold_ingot", above: 0 },
  { input: "raw_copper", output: "copper_ingot", above: 0 },
  { input: "sand", output: "glass", above: 32 },
  { input: "cobblestone", output: "stone", above: 256 },
];
// A batch: at most a stack; one coal (or charcoal) smelts 8
const BATCH = 64;
const PER_FUEL = 8;
// Torches kept on hand and in its chests
const TORCH_STOCK = 32;

/** What to put in the furnace next, from what it has (carried and stored): the first job with something past its pile. Pure. */
export function pickSmeltJob(have: (name: string) => number): { input: string; output: string; count: number } | null {
  for (const job of SMELT_JOBS) {
    const spare = have(job.input) - job.above;
    if (spare > 0) return { input: job.input, output: job.output, count: Math.min(BATCH, spare) };
  }
  return null;
}

const carried = (name: string): number => bot.inventory.items().filter((i) => i.name === name).reduce((n, i) => n + i.count, 0);

/**
 * One visit to its home furnace: what's done taken out, the next batch and
 * fuel put in, left smelting. What it did, or why not.
 */
export async function tendFurnace(): Promise<ActionResult<string>> {
  const { shelterSlots } = await import("../actions/building");
  const spot = shelterSlots()?.furnace;
  const furnace = spot ? knownBlock(new Vec3(spot.x, spot.y, spot.z)) : null;
  if (!spot || furnace?.name !== "furnace") return fail("not_found", "no furnace at home");
  const { storedNear, takeItems } = await import("../actions/storage");
  const have = (name: string): number => carried(name) + storedNear(name, 32);
  const job = pickSmeltJob(have);
  // The batch and its fuel from the chests first (the furnace may still be busy: then it only empties it)
  if (job && carried(job.input) < job.count) await takeItems([{ name: job.input, count: job.count - carried(job.input) }], true);
  const fuelNeeded = job ? Math.ceil(job.count / PER_FUEL) : 0;
  const fuelName = carried("coal") + storedNear("coal", 32) >= fuelNeeded ? "coal" : "charcoal";
  if (job && carried(fuelName) < fuelNeeded) await takeItems([{ name: fuelName, count: fuelNeeded - carried(fuelName) }], true);
  if (isCommandCancelled()) return fail("aborted", "stopped");
  if (!(await goTo(new pf.goals.GoalNear(spot.x, spot.y, spot.z, 2))).ok) return fail("unreachable", "can't get to my furnace");
  const { closeWindow, openFurnaceAt, windowStep } = await import("../core/containers");
  const opened = await openFurnaceAt(furnace);
  if (!opened.ok) return opened;
  const window = opened.value;
  const done: string[] = [];
  try {
    const out = window.outputItem();
    if (out && (await windowStep("taking out what's done", () => window.takeOutput())).ok) done.push(`took out ${out.count} ${out.name.replace(/_/g, " ")}`);
    // Busy with an earlier batch: left to it
    if (window.inputItem()) return ok(done.concat("the furnace is still busy").join("; "));
    if (!job || carried(job.input) === 0) return ok(done.concat("nothing to smelt").join("; "));
    const n = Math.min(carried(job.input), job.count);
    if (!window.fuelItem()) {
      const fuel = carried("coal") > 0 ? "coal" : carried("charcoal") > 0 ? "charcoal" : null;
      if (!fuel) return ok(done.concat("no fuel").join("; "));
      const fueled = await windowStep("fuelling", () => window.putFuel(bot.registry.itemsByName[fuel]!.id, null, Math.min(carried(fuel), Math.ceil(n / PER_FUEL))));
      if (!fueled.ok) return fueled;
    }
    const loaded = await windowStep(`putting ${job.input} in`, () => window.putInput(bot.registry.itemsByName[job.input]!.id, null, n));
    if (!loaded.ok) return loaded;
    done.push(`left ${n} ${job.input.replace(/_/g, " ")} smelting into ${job.output.replace(/_/g, " ")}`);
  } finally {
    closeWindow(window);
  }
  return ok(done.join("; "));
}

/** Torches made from stored coal when its torches run low (carried and in its chests). */
export async function topUpTorches(): Promise<void> {
  const { storedNear, takeItems } = await import("../actions/storage");
  const torches = carried("torch") + storedNear("torch", 32);
  if (torches >= TORCH_STOCK) return;
  const coal = carried("coal") + carried("charcoal");
  if (coal === 0 && storedNear("coal", 32) > 0) await takeItems([{ name: "coal", count: 8 }], true);
  if (carried("coal") + carried("charcoal") === 0) return;
  const { acquire } = await import("./acquire");
  const { liveWorld } = await import("./world");
  const want = carried("torch") + (TORCH_STOCK - torches);
  if ((await acquire("torch", want, liveWorld)).ok) console.log(`Workshop: made torches (${carried("torch")} carried).`);
}

/** The workshop round: the furnace tended, torches topped up. Says what it did. */
export async function workshop(): Promise<void> {
  const furnace = await tendFurnace();
  if (furnace.ok && furnace.value && !/^(nothing to smelt|the furnace is still busy)$/.test(furnace.value)) chatter(`Workshop: ${furnace.value}.`, "workshop");
  else if (!furnace.ok) console.log(`Workshop: ${furnace.ok ? "" : furnace.detail}.`);
  if (!isCommandCancelled()) await topUpTorches();
}
