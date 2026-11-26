// Path: src/roles/farmer.ts
// The farmer (Phase 8): harvests the ripe crops of a field and plants them
// again (actions/farming already replants, from farmland, never trampling
// it: it walks the pathfinder's way), then puts the crops in the role's
// chest, keeping seeds for the next sowing. By day only.

import pf from "mineflayer-pathfinder";
import { goTo } from "../core/primitives";
import { fail, ok } from "../core/result";
import type { Role } from "./role";
import type { Shift } from "./guard";

// What the owner may call a crop, and the crop block it grows as
const CROP_BLOCKS: Record<string, string> = {
  wheat: "wheat",
  carrot: "carrots",
  carrots: "carrots",
  potato: "potatoes",
  potatoes: "potatoes",
  beetroot: "beetroots",
  beetroots: "beetroots",
  melon: "melon",
  pumpkin: "pumpkin",
};
// What a harvest brings in (the produce that goes in the chest)
const PRODUCE = /^(wheat|carrot|potato|poisonous_potato|beetroot|melon_slice|melon|pumpkin|wheat_seeds|beetroot_seeds|sweet_berries)$/;
// Kept on the bot for sowing again
const KEEP_FOR_SOWING: Record<string, number> = { wheat_seeds: 16, beetroot_seeds: 16, carrot: 8, potato: 8 };

/** The crop blocks the role works on (null: every crop). Pure. */
export function cropBlocksFor(target: string | null): string[] | null {
  if (!target) return null;
  const block = CROP_BLOCKS[target.toLowerCase().replace(/\s+/g, "_")];
  return block ? [block] : null;
}

/** One pass over the field: harvest and replant what's ripe, then store the crops. */
export async function farmerShift(role: Role): Promise<Shift> {
  if (!role.anchor) return { result: fail("not_found", "I don't know where the field is; tell me while you stand in it"), restMs: 5 * 60_000 };
  const a = role.anchor;
  const there = await goTo(new pf.goals.GoalNear(a.x, a.y, a.z, 3));
  if (!there.ok) return { result: fail(there.reason, "I can't get to the field"), restMs: 2 * 60_000 };
  const { harvestCrops } = await import("../actions/farming");
  const harvested = await harvestCrops({ maxDistance: role.radius, only: cropBlocksFor(role.target) });
  if (harvested > 0) console.log(`Farmer: harvested and replanted ${harvested} crops.`);
  const { depositAt } = await import("../actions/storage");
  const stored = await depositAt(role.storage, (n) => PRODUCE.test(n), KEEP_FOR_SOWING);
  if (stored.problem && harvested > 0) return { result: fail("refused", `I harvested ${harvested} crops but couldn't store them: ${stored.problem}`), restMs: 60_000 };
  // Nothing ripe: look again in a couple of minutes (crops take a while)
  return { result: ok(), restMs: harvested > 0 ? 30_000 : 2 * 60_000 };
}
