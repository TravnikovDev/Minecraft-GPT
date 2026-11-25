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
// A source that failed twice in a row waits a minute. Once for five minutes
// was far too harsh: one tree it couldn't reach blocked all wood, and every
// milestone failed in a row (fresh-world test)
const DEMOTED_FOR_MS = 60_000;
const FAILS_BEFORE_DEMOTION = 2;
const failsInARow = new Map<string, number>();

/** A way to get a raw material. */
export type Source = {
  name: string;
  /** Which missing material (exact name or group like "logs") it gets. */
  gets: (material: string) => boolean;
  /** What it needs first for `count` of `material` (a pickaxe to mine stone, a furnace and logs for charcoal): items to acquire. */
  needs?: (material: string, count: number) => { item: string; count: number }[];
  /** Gets about `count` of it; ok when it got any. */
  run: (material: string, count: number) => Promise<ActionResult>;
  /** It collects from the world (trees, stone, ores, animals): those get the margin; making things (smelting) doesn't. */
  collects?: boolean;
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
/**
 * How much to collect when `n` raw resources are missing: about 20% more,
 * at least one spare (owner: a 10-30% margin, only for collecting from the
 * world, never for items or furniture it makes). Pure.
 */
export const withMargin = (n: number): number => Math.ceil(n * GATHER_MARGIN);
const GATHER_MARGIN = 1.2;

export async function acquire(item: string, count: number, world: AcquireWorld, depth = 0): Promise<ActionResult> {
  // Deep enough for diamonds: iron pickaxe -> ingots -> furnace -> stone -> wooden pickaxe -> table
  if (depth > MAX_DEPTH) return fail("missing_items", `${item}: too many things needed first`);
  // Only rounds that got nothing count against it: a craft that makes 1 of 6
  // chests at a time is progress (it gave up on the 6th, fresh-world test)
  let lastHave = -1;
  for (let round = 0, stalled = 0; stalled < MAX_ROUNDS && round < MAX_ROUNDS * 4; round++) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    const have = world.have(item);
    if (have >= count) return ok();
    if (have <= lastHave) stalled++;
    lastHave = have;
    const want = count - have;

    // A table first when a recipe on the way needs one (its planks would
    // otherwise be counted for the item and then used up by the table)
    const plan = world.plan(item, want);
    if (plan.needsTable && !world.tableAccess()) {
      const table = await acquire("crafting_table", 1, world, depth + 1);
      if (!table.ok) return table;
      continue; // plan again with the table
    }

    // A raw material itself (logs, cobblestone, wool, coal): straight from
    // its source, not through some recipe for it (wool from string, coal
    // from a coal block) unless that recipe can be made right now
    const direct = world.sources.find((s) => s.gets(item) && !demoted(s, item));
    let raw = direct && plan.missing.length > 0 ? [{ name: item, count: want }] : plan.missing;
    console.log(`Getting ${want} ${item} (round ${round + 1}): ${raw.length ? `missing ${raw.map((m) => `${m.count} ${m.name}`).join(", ")}` : "crafting it"}.`);

    if (raw.length === 0) {
      // A craft only counts if the item really came out (a planner that thinks
      // the third wool can be crafted from two burned every round silently)
      const crafted = await world.craft(item, want);
      if (crafted && world.have(item) > have) continue;
      console.log(`Crafting ${item} didn't work${direct ? `; getting it by ${direct.name} instead` : "; planning again"}.`);
      if (!direct) continue;
      raw = [{ name: item, count: want }];
    }

    for (const m of raw) {
      const source = world.sources.find((s) => s.gets(m.name) && !demoted(s, m.name));
      if (!source) return fail("missing_items", `I don't know how to get ${m.name.replace(/_/g, " ")}`);
      for (const need of source.needs?.(m.name, m.count) ?? []) {
        if (world.have(need.item) >= need.count) continue;
        const got = await acquire(need.item, need.count, world, depth + 1);
        if (!got.ok) return got;
      }
      // The margin only for collecting raw resources, never for making things
      const result = await source.run(m.name, source.collects ? withMargin(m.count) : m.count);
      if (isCommandCancelled()) return fail("aborted", "stopped");
      const key = `${source.name}:${m.name}`;
      if (result.ok) {
        failsInARow.delete(key);
      } else {
        const fails = (failsInARow.get(key) ?? 0) + 1;
        failsInARow.set(key, fails);
        if (fails >= FAILS_BEFORE_DEMOTION) {
          console.log(`Getting ${m.name} by ${source.name} failed ${fails} times; trying something else for a minute.`);
          demotedUntil.set(key, Date.now() + DEMOTED_FOR_MS);
          failsInARow.delete(key);
        } else {
          console.log(`Getting ${m.name} by ${source.name} failed; trying again.`);
        }
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
  failsInARow.clear();
}
