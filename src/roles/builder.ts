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
import { isNatural } from "../core/movements";
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

/** Plants and the like: cleared freely (flowers, grass, saplings, crops, snow layers). */
const PLANT = /^(short_grass|tall_grass|fern|large_fern|dead_bush|dandelion|poppy|[a-z_]+_tulip|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|sunflower|lilac|rose_bush|peony|[a-z_]+_sapling|sweet_berry_bush|vine|snow|[a-z_]+_mushroom|sugar_cane)$/;

/**
 * What to do about each spot of the blueprint, given what's there now:
 * - clear: natural terrain and plants in the way (top down);
 * - fill: water or lava in a spot (filled with a block first, then it's clear or placed);
 * - place: the blocks still to put (bottom layer first; a layer's outer edge first, so a roof always has support);
 * - blocked: anything else in a spot (a chest, a bed, the owner's walls, its shelter): never broken, reported.
 * Pure: `natural` says which blocks are terrain (core/movements isNatural).
 */
export function workLeft(
  plan: Blueprint,
  at: (b: BlueprintBlock) => string | null,
  natural: (name: string) => boolean = () => true
): { clear: BlueprintBlock[]; fill: BlueprintBlock[]; place: BlueprintBlock[]; blocked: { b: BlueprintBlock; name: string }[] } {
  const isAir = (n: string | null): boolean => n === null || n === "air" || n === "cave_air" || n === "void_air";
  const clear: BlueprintBlock[] = [];
  const fill: BlueprintBlock[] = [];
  const place: BlueprintBlock[] = [];
  const blocked: { b: BlueprintBlock; name: string }[] = [];
  for (const b of plan.blocks) {
    const now = at(b);
    if (now === b.name || (b.name === "air" && isAir(now))) continue;
    if (now === "water" || now === "lava") fill.push(b);
    else if (!isAir(now)) {
      if (natural(now!) || PLANT.test(now!)) clear.push(b);
      else {
        blocked.push({ b, name: now! });
        continue; // never broken: nothing goes in this spot
      }
    }
    if (b.name !== "air") place.push(b);
  }
  const ring = (b: BlueprintBlock): number => Math.max(Math.abs(b.dx), Math.abs(b.dz));
  clear.sort((a, b) => b.dy - a.dy);
  place.sort((a, b) => a.dy - b.dy || ring(b) - ring(a));
  return { clear, fill, place, blocked };
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
  const left = workLeft(plan, (b) => bot.blockAt(cell(b))?.name ?? null, isNatural);
  const inTheWay = left.blocked.map(({ b, name: what }) => `your ${what.replace(/_/g, " ")} at ${cell(b)}`);
  if (left.clear.length === 0 && left.fill.length === 0 && left.place.length === 0) {
    if (inTheWay.length > 0) return { result: fail("refused", `the ${name} is done except where ${inTheWay.slice(0, 3).join(", ")} ${inTheWay.length === 1 ? "is" : "are"} in the way (I won't break it)`), restMs: 10 * 60_000, progress: false };
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
  // Water or lava in a spot: its own block goes straight in; a spot meant to
  // stay open gets dirt (terrain, so a later shift clears it again)
  for (const b of left.fill) {
    if (isCommandCancelled() || done >= PER_SHIFT) break;
    const block = b.name !== "air" ? b.name : "dirt";
    if (carried(block) === 0) continue;
    const p = cell(b);
    await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 3));
    if ((await placeBlockResult(block, p.x, p.y, p.z)).ok) done++;
  }
  for (const b of left.clear) {
    if (isCommandCancelled() || done >= PER_SHIFT) break;
    const p = cell(b);
    await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 3));
    const broken = await breakBlockAtResult(p.x, p.y, p.z);
    if (broken.ok && !broken.value.alreadyGone) done++;
  }
  for (const b of left.place) {
    if (isCommandCancelled() || done >= PER_SHIFT) break;
    if (carried(b.name) === 0) continue;
    const p = cell(b);
    await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 3));
    if ((await placeBlockResult(b.name, p.x, p.y, p.z)).ok) done++;
  }
  console.log(`Builder: ${done} blocks of the ${name} this shift (${left.place.length} were left to place).`);
  if (inTheWay.length > 0 && done === 0) return { result: fail("refused", `${inTheWay.slice(0, 3).join(", ")} ${inTheWay.length === 1 ? "is" : "are"} in the way of the ${name} (I won't break it)`), restMs: 5 * 60_000, progress: false };
  return { result: ok(), restMs: 5_000, progress: done > 0 };
}
