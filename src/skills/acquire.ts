// Path: src/skills/acquire.ts
// Getting an item from scratch (Phase 6): the one planner the skills share.
// acquire(item, n) asks the craft planner what's missing, gets each missing
// raw material from a source (logs from trees, cobblestone from stone, wool
// from sheep...), makes sure there's a crafting table when a recipe needs
// one, crafts, and checks again. Bounded: a few rounds at most, and a source
// that just failed is set aside for a while (the next one is tried).
//
// Nothing here calls the ensure* helpers, and they call this (actions/ensure):
// the old ensure -> tools -> crafting -> gathering recursion is gone.

import { fail, ok, type ActionResult } from "../core/result";
import { isCommandCancelled } from "../core/commandContext";

const MAX_ROUNDS = 6;
const MAX_DEPTH = 6;
const DEMOTED_FOR_MS = 5 * 60_000;

/** A way to get a raw material. */
export type Source = {
  name: string;
  /** Which missing material (exact name or group like "logs") it gets. */
  gets: (material: string) => boolean;
  /** What it needs first for `count` of `material` (a pickaxe to mine stone, a furnace and logs for charcoal): items to acquire. */
  needs?: (material: string, count: number) => { item: string; count: number }[];
  /** Gets about `count` of it; ok when it got any. */
  run: (material: string, count: number) => Promise<ActionResult>;
};

/** What acquire works with: the live game by default, a fake in tests. */
export type AcquireWorld = {
  /** How many it has (exact name or group). */
  have: (item: string) => number;
  /** What crafting `count` more would still need (raw materials), and whether a recipe on the way needs a table. */
  plan: (item: string, count: number) => { missing: { name: string; count: number }[]; needsTable: boolean };
  /** Crafts it (and its parts) from what it carries. */
  craft: (item: string, count: number) => Promise<boolean>;
  /** A crafting table carried or close by. */
  tableAccess: () => boolean;
  sources: Source[];
};

const demotedUntil = new Map<string, number>();

/**
 * Gets `count` of `item` (an exact item, or "logs"), crafting and gathering
 * what's needed. `depth` guards the prerequisites (a table, a pickaxe).
 */
export async function acquire(item: string, count: number, world: AcquireWorld, depth = 0): Promise<ActionResult> {
  // Deep enough for diamonds: iron pickaxe -> ingots -> furnace -> stone -> wooden pickaxe -> table
  if (depth > MAX_DEPTH) return fail("missing_items", `${item}: too many things needed first`);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    const have = world.have(item);
    if (have >= count) return ok();
    const want = count - have;

    // A table first when a recipe on the way needs one (its planks would
    // otherwise be counted for the item and then used up by the table)
    const plan = world.plan(item, want);
    if (plan.needsTable && !world.tableAccess()) {
      const table = await acquire("crafting_table", 1, world, depth + 1);
      if (!table.ok) return table;
      continue; // plan again with the table
    }

    // A raw material itself (logs, cobblestone, wool): straight from a source
    const direct = world.sources.find((s) => s.gets(item) && !demoted(s, item));
    const raw = direct && plan.missing.some((m) => m.name === item) ? [{ name: item, count: want }] : plan.missing;

    if (raw.length === 0) {
      if (!(await world.craft(item, want))) console.log(`Crafting ${item} didn't work this round; planning again.`);
      continue;
    }

    for (const m of raw) {
      const source = world.sources.find((s) => s.gets(m.name) && !demoted(s, m.name));
      if (!source) return fail("missing_items", `I don't know how to get ${m.name.replace(/_/g, " ")}`);
      for (const need of source.needs?.(m.name, m.count) ?? []) {
        if (world.have(need.item) >= need.count) continue;
        const got = await acquire(need.item, need.count, world, depth + 1);
        if (!got.ok) return got;
      }
      const result = await source.run(m.name, m.count);
      if (isCommandCancelled()) return fail("aborted", "stopped");
      if (!result.ok) {
        console.log(`Getting ${m.name} by ${source.name} failed; trying something else for a while.`);
        demotedUntil.set(`${source.name}:${m.name}`, Date.now() + DEMOTED_FOR_MS);
      }
    }
  }
  return world.have(item) >= count ? ok() : fail("missing_items", `couldn't get ${count} ${item.replace(/_/g, " ")}`);
}

/** Set aside for this material only: no coal ore around says nothing about iron. */
function demoted(source: Source, material: string): boolean {
  return (demotedUntil.get(`${source.name}:${material}`) ?? 0) > Date.now();
}

/** Forgets which sources failed (tests, a new day). */
export function clearDemotions(): void {
  demotedUntil.clear();
}
