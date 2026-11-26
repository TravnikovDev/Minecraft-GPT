// Path: src/roles/miner.ts
// The miner (Phase 8): a trip down its own mine for the ore the owner wants
// (skills/mine: strip mining with torches, lava and water plugged, deeper
// levels when a level is mined out, home when the pickaxe wears out or the
// inventory is full), then the ore goes into the role's chest. Under ground
// the night doesn't matter.

import { describeFailure, fail, ok } from "../core/result";
import { catalog } from "../core/catalog";
import type { Role } from "./role";
import type { Shift } from "./guard";

// What the owner may ask for, and the item the mine brings back
const ORES: Record<string, string> = {
  iron: "raw_iron",
  raw_iron: "raw_iron",
  coal: "coal",
  diamond: "diamond",
  diamonds: "diamond",
  gold: "raw_gold",
  raw_gold: "raw_gold",
  cobblestone: "cobblestone",
  stone: "cobblestone",
};
// Everything a mining trip brings back worth storing
const LOOT = /^(coal|raw_iron|raw_gold|raw_copper|diamond|emerald|redstone|lapis_lazuli|quartz|iron_ingot|gold_ingot|copper_ingot)$/;
// A trip's worth
const PER_TRIP = 16;

/**
 * The item the role mines for: iron unless told otherwise; a word it knows
 * ("diamonds"), or an item an ore drops ("redstone", "lapis_lazuli": checked
 * against the game's ores); null for anything else (never iron by mistake).
 * `oreDrop` is injectable for tests.
 */
export function oreFor(target: string | null, oreDrop: (item: string) => boolean = (i) => catalog().oresFor(i).length > 0): string | null {
  const word = (target ?? "iron").toLowerCase().replace(/\s+/g, "_");
  if (ORES[word]) return ORES[word]!;
  if (oreDrop(word)) return word;
  if (oreDrop(`raw_${word}`)) return `raw_${word}`;
  return null;
}

/** One trip: mine for the ore, then store what it brought back. */
export async function minerShift(role: Role): Promise<Shift> {
  const item = oreFor(role.target);
  if (!item) return { result: fail("not_found", `I don't know "${role.target}" as something to mine (iron, coal, gold, diamonds, redstone, lapis...)`), restMs: 10 * 60_000 };
  const { mineFor } = await import("../skills/mine");
  const mined = await mineFor(item, PER_TRIP);
  const { depositAt } = await import("../actions/storage");
  // Cobblestone stays with it when that's not the job (it builds with it)
  const stored = await depositAt(role.storage, (n) => LOOT.test(n) || (item === "cobblestone" && n === "cobblestone"), { cobblestone: 16, coal: 8 });
  if (!mined.ok) return { result: fail(mined.reason, `no ${item.replace(/_/g, " ")} this trip: ${describeFailure(mined)}`), restMs: 2 * 60_000 };
  if (stored.problem) return { result: fail("refused", `I couldn't store the ore: ${stored.problem}`), restMs: 60_000 };
  return { result: ok(), restMs: 20_000, progress: true };
}
