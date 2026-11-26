// Path: src/roles/builder.ts
// The builder (Phase 8): builds a blueprint at the spot the owner showed
// it. A blueprint is a list of blocks by offset from that spot (y 0 is the
// level the owner stood on). Each shift: what's not built yet is worked out
// from the world itself, the materials are got (its chests, the mine, trees:
// the item planner), wrong blocks in the way are cleared, then up to a few
// dozen blocks are placed, bottom layer first. What it can't get is said.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { isCommandCancelled } from "../core/commandContext";
import { report } from "../core/narrator";
import { goTo } from "../core/primitives";
import { describeFailure, fail, ok } from "../core/result";
import { clearRole, type Role } from "./role";
import type { Shift } from "./guard";

export type BlueprintBlock = { dx: number; dy: number; dz: number; name: string };
export type Blueprint = { about: string; blocks: BlueprintBlock[] };

// Blocks placed per shift (then the next shift; the owner can cut in)
const PER_SHIFT = 32;

/** A hut: 5x5 cobblestone walls 3 high, a doorway on the north side, a plank roof, open inside. Pure. */
function hut(): Blueprint {
  const blocks: BlueprintBlock[] = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      for (let dy = 0; dy <= 2; dy++) {
        const doorway = dx === 0 && dz === -2 && dy <= 1;
        blocks.push({ dx, dy, dz, name: edge && !doorway ? "cobblestone" : "air" });
      }
      blocks.push({ dx, dy: 3, dz, name: "oak_planks" });
    }
  }
  return { about: "a 5x5 cobblestone hut with a plank roof and a doorway on the north side", blocks };
}

/** A pen: a 7x7 ring of oak fence with a gate on the north side. Pure. */
function pen(): Blueprint {
  const blocks: BlueprintBlock[] = [];
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      if (Math.abs(dx) !== 3 && Math.abs(dz) !== 3) continue;
      blocks.push({ dx, dy: 0, dz, name: dx === 0 && dz === -3 ? "oak_fence_gate" : "oak_fence" });
    }
  }
  return { about: "a 7x7 animal pen of oak fence with a gate on the north side", blocks };
}

/** A wall: 9 cobblestone blocks long (east-west), 3 high. Pure. */
function wall(): Blueprint {
  const blocks: BlueprintBlock[] = [];
  for (let dx = -4; dx <= 4; dx++) for (let dy = 0; dy <= 2; dy++) blocks.push({ dx, dy, dz: 0, name: "cobblestone" });
  return { about: "a cobblestone wall 9 long and 3 high", blocks };
}

export const BLUEPRINTS: Record<string, () => Blueprint> = { hut, pen, wall };

/** The blueprint the owner asked for (a hut when unsure). */
export function blueprintFor(target: string | null): { name: string; plan: Blueprint } {
  const name = target && BLUEPRINTS[target.toLowerCase()] ? target.toLowerCase() : "hut";
  return { name, plan: BLUEPRINTS[name]!() };
}

/**
 * The blocks still to do, given what's in the world: clearing first (top
 * down, so nothing is left hanging), then placing bottom layer first. Pure.
 */
export function workLeft(plan: Blueprint, at: (b: BlueprintBlock) => string | null): { clear: BlueprintBlock[]; place: BlueprintBlock[] } {
  const isAir = (n: string | null): boolean => n === null || n === "air" || n === "cave_air" || n === "short_grass" || n === "tall_grass" || n === "fern";
  const clear: BlueprintBlock[] = [];
  const place: BlueprintBlock[] = [];
  for (const b of plan.blocks) {
    const now = at(b);
    if (b.name === "air") {
      if (!isAir(now)) clear.push(b);
    } else if (now !== b.name) {
      if (!isAir(now)) clear.push(b); // something else in the spot
      place.push(b);
    }
  }
  clear.sort((a, b) => b.dy - a.dy);
  place.sort((a, b) => a.dy - b.dy || Math.abs(a.dx) + Math.abs(a.dz) - (Math.abs(b.dx) + Math.abs(b.dz)));
  return { clear, place };
}

/** How many of each block the placing still needs, minus what it carries. Pure. */
export function materialsShort(place: BlueprintBlock[], carried: (name: string) => number): Map<string, number> {
  const need = new Map<string, number>();
  for (const b of place) need.set(b.name, (need.get(b.name) ?? 0) + 1);
  const short = new Map<string, number>();
  for (const [name, n] of need) if (n - carried(name) > 0) short.set(name, n - carried(name));
  return short;
}

/** One shift: get materials, clear the spot, place a few dozen blocks; done when nothing's left. */
export async function builderShift(role: Role): Promise<Shift> {
  if (!role.anchor) return { result: fail("not_found", "I don't know where to build; tell me while you stand on the spot"), restMs: 5 * 60_000 };
  const a = role.anchor;
  const { name, plan } = blueprintFor(role.target);
  const cell = (b: BlueprintBlock): Vec3 => new Vec3(a.x + b.dx, a.y + b.dy, a.z + b.dz);
  const there = await goTo(new pf.goals.GoalNear(a.x, a.y, a.z, 4));
  if (!there.ok) return { result: fail(there.reason, "I can't get to the building spot"), restMs: 2 * 60_000 };
  const left = workLeft(plan, (b) => bot.blockAt(cell(b))?.name ?? null);
  if (left.clear.length === 0 && left.place.length === 0) {
    report(`The ${name} is finished: ${plan.about}.`);
    await clearRole();
    return { result: ok(), restMs: 0 };
  }
  // Materials first: from its chests, the mine, trees (the item planner)
  const carried = (n: string): number => bot.inventory.items().filter((i) => i.name === n).reduce((s, i) => s + i.count, 0);
  const { acquire } = await import("../skills/acquire");
  const { liveWorld } = await import("../skills/world");
  for (const [material, n] of materialsShort(left.place, carried)) {
    if (isCommandCancelled()) return { result: fail("aborted", "stopped"), restMs: 0 };
    const got = await acquire(material, n, liveWorld);
    if (!got.ok && carried(material) === 0) return { result: fail(got.reason, `I'm missing ${n} ${material.replace(/_/g, " ")} for the ${name} (${describeFailure(got)})`), restMs: 3 * 60_000 };
  }
  const { breakBlockAtResult } = await import("../actions/blockBreaking");
  const { placeBlockResult } = await import("../actions/blockPlacing");
  let done = 0;
  for (const b of left.clear) {
    if (isCommandCancelled() || done >= PER_SHIFT) break;
    const p = cell(b);
    await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 3));
    if ((await breakBlockAtResult(p.x, p.y, p.z)).ok) done++;
  }
  for (const b of left.place) {
    if (isCommandCancelled() || done >= PER_SHIFT) break;
    if (carried(b.name) === 0) continue;
    const p = cell(b);
    await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 3));
    if ((await placeBlockResult(b.name, p.x, p.y, p.z)).ok) done++;
  }
  console.log(`Builder: ${done} blocks of the ${name} this shift (${left.place.length} were left to place).`);
  return { result: ok(), restMs: 5_000 };
}
