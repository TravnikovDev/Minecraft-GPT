// Path: src/skills/oreCaps.ts
// Ores it stops mining once it owns plenty (owner, 2026-11-28: "make the bot
// stop digging copper if it has more than 64"). Counted in raw ore, ingots and
// blocks (9 each), carried and in its own chests.

import { bot } from "../core/body";
import { storedNear } from "../actions/storage";

/** Owned this many or more: that ore is left in the walls. */
export const ORE_CAPS: Record<string, number> = { copper: 64 };

// What counts as owning some of each capped ore, and how many each is worth
const OWNED_AS: Record<string, Array<[string, number]>> = {
  copper: [
    ["raw_copper", 1],
    ["copper_ingot", 1],
    ["raw_copper_block", 9],
    ["copper_block", 9],
  ],
};

/** How much of an ore kind ("copper") it owns, in raw ore. Pure over `count`. */
export function ownedOre(kind: string, count: (item: string) => number): number {
  return (OWNED_AS[kind] ?? []).reduce((n, [item, each]) => n + each * count(item), 0);
}

/** True when it owns enough of this ore kind that it isn't mined any more. Pure over `count`. */
export function oreCappedBy(kind: string, count: (item: string) => number): boolean {
  const cap = ORE_CAPS[kind];
  return cap !== undefined && ownedOre(kind, count) >= cap;
}

/** The ore kind of a block or drop name ("deepslate_copper_ore", "raw_copper" -> "copper"), or null. */
export function oreKindOf(name: string): string | null {
  const m = /^(?:deepslate_|nether_|raw_)?([a-z]+?)(?:_ore)?$/.exec(name);
  return m && m[1]! in ORE_CAPS ? m[1]! : null;
}

/** The live check: carried and in its own chests. */
export function oreCapped(name: string): boolean {
  const kind = oreKindOf(name);
  if (!kind) return false;
  const carried = (item: string): number => (bot.inventory?.items() ?? []).filter((i) => i.name === item).reduce((n, i) => n + i.count, 0);
  return oreCappedBy(kind, (item) => carried(item) + storedNear(item));
}
