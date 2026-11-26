// Path: src/roles/farmer.ts
// The farmer (Phase 8): harvests the ripe crops of a field and plants them
// again (actions/farming already replants, from farmland, never trampling
// it: it walks the pathfinder's way), then puts the crops in the role's
// chest, keeping seeds for the next sowing. By day only.

import pf from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { forbiddenAt } from "../core/forbidden";
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

/**
 * The crop blocks the role works on: null for every crop (no target), the
 * crop's block, or "unknown" for a word it doesn't know as a crop (never
 * "every crop" by mistake). Pure.
 */
export function cropBlocksFor(target: string | null): string[] | null | "unknown" {
  if (!target) return null;
  const block = CROP_BLOCKS[target.toLowerCase().replace(/\s+/g, "_")];
  return block ? [block] : "unknown";
}

/** True when ripe crops stand on the field now (the field must be in view). */
export async function farmHasWork(role: Role): Promise<boolean> {
  if (!role.anchor) return true; // the shift says what's wrong
  const crops = cropBlocksFor(role.target);
  if (crops === "unknown") return true;
  const { findRipeCrops } = await import("../actions/farming");
  const a = new Vec3(role.anchor.x, role.anchor.y, role.anchor.z);
  // The field out of view: go and look now and then (the runner's rest paces it)
  if (!bot.blockAt(a)) return true;
  return findRipeCrops(role.radius, crops, a).length > 0;
}

/** One pass over the field: harvest and replant what's ripe, then store the crops. */
export async function farmerShift(role: Role): Promise<Shift> {
  if (!role.anchor) return { result: fail("not_found", "I don't know where the field is; tell me while you stand in it"), restMs: 5 * 60_000 };
  const crops = cropBlocksFor(role.target);
  if (crops === "unknown") return { result: fail("not_found", `I don't know "${role.target}" as a crop (wheat, carrots, potatoes, beetroots, melons, pumpkins)`), restMs: 10 * 60_000 };
  const a = role.anchor;
  const field = new Vec3(a.x, a.y, a.z);
  const keepOut = forbiddenAt(field);
  if (keepOut) return { result: fail("forbidden", `the field is in a keep-out area (${keepOut.reason}); say "you can work here" there if I may`), restMs: 10 * 60_000 };
  const there = await goTo(new pf.goals.GoalNear(a.x, a.y, a.z, 3));
  if (!there.ok) return { result: fail(there.reason, "I can't get to the field"), restMs: 2 * 60_000 };
  const { harvestCrops } = await import("../actions/farming");
  // Around the field, not around itself (the search drifted to the neighbours' fields)
  const harvested = await harvestCrops({ maxDistance: role.radius, only: crops, point: field });
  if (harvested > 0) console.log(`Farmer: harvested and replanted ${harvested} crops.`);
  const { depositAt } = await import("../actions/storage");
  const stored = await depositAt(role.storage, (n) => PRODUCE.test(n), KEEP_FOR_SOWING);
  if (stored.problem && harvested > 0) return { result: fail("refused", `I harvested ${harvested} crops but couldn't store them: ${stored.problem}`), restMs: 60_000 };
  // Nothing ripe: look again in a couple of minutes (crops take a while)
  return { result: ok(), restMs: harvested > 0 ? 30_000 : 2 * 60_000, progress: harvested > 0 };
}
