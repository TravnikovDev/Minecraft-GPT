// Path: src/skills/bridge.ts
// A bridge over the river by its home (owner, 2026-11-27: "the river is near
// the house; build a bridge in case the river is pretty close to the base").
// When: water within HOME_RADIUS of its shelter's entrance that it really
// crosses (it went into it SWIMS_WANTED times, or its field is on the other
// side), at a crossing no wider than MAX_SPAN blocks of water. A low-priority
// job after its first day, by day only (milestones: "bridge").
// How: straight bank to bank, 2 wide, at the banks' height, cobblestone (or
// planks), built block by block forward from the deck it stands on, torches
// at both ends and every TORCH_EVERY blocks. Remembered as its bridge: its own
// digging and walks never break it, and a hole (a creeper) is mended.

import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { isCommandCancelled } from "../core/commandContext";
import { protectCells } from "../core/movements";
import { chatter } from "../core/narrator";
import { goTo, knownBlock } from "../core/primitives";
import { fail, ok, type ActionResult } from "../core/result";
import { addPlace, getMemory, getPlaces, updateMemory } from "../managers/persistenceManager";
import { placeBlockResult } from "../actions/blockPlacing";
import { shelter } from "./capabilities";
import pf from "mineflayer-pathfinder";

// Owner's choices (the concept he picked)
export const HOME_RADIUS = 24;
export const SWIMS_WANTED = 2;
export const MAX_SPAN = 12;
export const TORCH_EVERY = 6;
// How far round where it swam it looks for the narrowest crossing
const SEARCH = 12;
// Swims closer together than this are one swim
const SWIM_GAP_MS = 30_000;
const SWIMS_KEPT = 10;

type P3 = { x: number; y: number; z: number };
type Seen = { name: string; boundingBox: string } | null;
export type BlockAtFn = (p: Vec3) => Seen;

/** A bridge: its first deck cell over the water, the way across, how many cells, the second column's side. */
export type BridgePlan = { start: P3; step: { dx: number; dz: number }; side: { dx: number; dz: number }; span: number };

const isWater = (b: Seen): boolean => b !== null && (b.name === "water" || b.name === "bubble_column");
const isOpen = (b: Seen): boolean => b !== null && b.boundingBox === "empty" && !isWater(b) && b.name !== "lava";
const isGround = (b: Seen): boolean => b !== null && b.boundingBox === "block" && !b.name.endsWith("_leaves") && !/_log$|_wood$/.test(b.name);

/** The deck's cells, from the first bank out: both columns. Pure. */
export function deckCells(plan: BridgePlan): Vec3[] {
  const out: Vec3[] = [];
  for (let k = 0; k < plan.span; k++) {
    const c = new Vec3(plan.start.x + plan.step.dx * k, plan.start.y, plan.start.z + plan.step.dz * k);
    out.push(c, c.offset(plan.side.dx, 0, plan.side.dz));
  }
  return out;
}

/** Where its torches go: on the outer column, at both ends and every TORCH_EVERY cells. Pure. */
export function torchCells(plan: BridgePlan): Vec3[] {
  const ks = new Set<number>([0, plan.span - 1]);
  for (let k = TORCH_EVERY; k < plan.span - 1; k += TORCH_EVERY) ks.add(k);
  return [...ks].sort((a, b) => a - b).map((k) => new Vec3(plan.start.x + plan.step.dx * k + plan.side.dx, plan.start.y + 1, plan.start.z + plan.step.dz * k + plan.side.dz));
}

/**
 * The bank's walking level at a column: the top of the ground there (from
 * `y + 2` down to `y - 1`), with two open blocks over it; null for water or
 * no ground. Pure but for `at`.
 */
function bankTop(x: number, y: number, z: number, at: BlockAtFn): number | null {
  for (let top = y + 2; top >= y - 1; top--) {
    const b = at(new Vec3(x, top, z));
    if (isWater(b)) return null;
    if (isGround(b)) return isOpen(at(new Vec3(x, top + 1, z))) && isOpen(at(new Vec3(x, top + 2, z))) ? top : null;
  }
  return null;
}

/** The water's surface at a column near `y` (water with no water over it), or null. Pure but for `at`. */
function waterSurface(x: number, y: number, z: number, at: BlockAtFn): number | null {
  for (let top = y + 2; top >= y - 3; top--) {
    if (isWater(at(new Vec3(x, top, z)))) return isWater(at(new Vec3(x, top + 1, z))) ? null : top;
    if (at(new Vec3(x, top, z))?.boundingBox === "block") return null;
  }
  return null;
}

const STEPS = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
];

/**
 * The narrowest straight crossing near `centre`: from a bank, over 2 to
 * MAX_SPAN blocks of water, to a bank at most a block higher or lower, with
 * room for a 2-wide deck at the banks' height and headroom over it. Ties go
 * to the one nearest `centre`. Null when there's none. Pure but for `at`.
 */
export function planCrossing(centre: P3, at: BlockAtFn, search = SEARCH): BridgePlan | null {
  let best: { plan: BridgePlan; score: number } | null = null;
  for (let dx = -search; dx <= search; dx++)
    for (let dz = -search; dz <= search; dz++) {
      const x = centre.x + dx;
      const z = centre.z + dz;
      const from = bankTop(x, centre.y, z, at);
      if (from === null) continue;
      for (const step of STEPS) {
        const plan = crossingFrom(x, from, z, step, at);
        if (!plan) continue;
        const mid = { x: plan.start.x + (step.dx * plan.span) / 2, z: plan.start.z + (step.dz * plan.span) / 2 };
        const score = plan.span * 100 + Math.hypot(mid.x - centre.x, mid.z - centre.z);
        if (!best || score < best.score) best = { plan, score };
      }
    }
  return best?.plan ?? null;
}

/** A crossing from the bank at (x, top, z) going `step`, or null. */
function crossingFrom(x: number, top: number, z: number, step: { dx: number; dz: number }, at: BlockAtFn): BridgePlan | null {
  let span = 0;
  let surface: number | null = null;
  for (let k = 1; k <= MAX_SPAN + 1; k++) {
    const cx = x + step.dx * k;
    const cz = z + step.dz * k;
    const w = waterSurface(cx, top, cz, at);
    if (w !== null) {
      if (surface !== null && w !== surface) return null; // a river is level
      surface = w;
      span = k;
      continue;
    }
    const other = bankTop(cx, top, cz, at);
    if (other === null || span < 2 || Math.abs(other - top) > 1) return null;
    // The deck at the lower bank's height, over the water, never under it
    const deckY = Math.min(top, other);
    if (surface === null || deckY < surface) return null;
    // Both columns: room for the deck (water or open) and headroom over it
    for (const side of [{ dx: step.dz, dz: step.dx }, { dx: -step.dz, dz: -step.dx }]) {
      const plan: BridgePlan = { start: { x: x + step.dx, y: deckY, z: z + step.dz }, step, side, span };
      if (deckCells(plan).every((c) => (isWater(at(c)) || isOpen(at(c))) && isOpen(at(c.offset(0, 1, 0))) && isOpen(at(c.offset(0, 2, 0))))) return plan;
    }
    return null;
  }
  return null; // wider than MAX_SPAN
}

// --- Swims near home -----------------------------------------------------------

let wasInWater = false;

/** Its shelter's entrance (where "near home" is measured from), or null. */
function homeStart(): P3 | null {
  const start = shelter()?.details?.["start"] as P3 | undefined;
  return start ?? null;
}

/** Called every second: notes when it goes into the water near its home, on the surface (not its mine). */
export function noteSwim(): void {
  if (!bot.entity) return;
  const inWater = Boolean((bot.entity as unknown as { isInWater?: boolean }).isInWater);
  const entered = inWater && !wasInWater;
  wasInWater = inWater;
  const home = homeStart();
  if (!entered || !home) return;
  const p = bot.entity.position;
  if (Math.hypot(p.x - home.x, p.z - home.z) > HOME_RADIUS || p.y < home.y - 4) return;
  const swims = getMemory().swims ?? [];
  const last = swims[swims.length - 1];
  if (last && Date.now() - last.at < SWIM_GAP_MS) return;
  const at = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), at: Date.now() };
  console.log(`Bridge: in the water near my home at (${at.x}, ${at.y}, ${at.z}).`);
  updateMemory({ swims: [...swims, at].slice(-SWIMS_KEPT) }).catch((error: Error) => console.error(`Saving a swim failed: ${error.message}`));
}

/** Its swims near its home now (its home may have moved since). */
function swimsNearHome(): P3[] {
  const home = homeStart();
  if (!home) return [];
  return (getMemory().swims ?? []).filter((s) => Math.hypot(s.x - home.x, s.z - home.z) <= HOME_RADIUS);
}

/** Where on the way from its home to its field the water is, if anywhere (it crosses there to get to it). */
async function fieldAcrossWater(): Promise<P3 | null> {
  const home = homeStart();
  const { myFarm } = await import("./farm");
  const field = myFarm();
  if (!home || !field) return null;
  const n = Math.ceil(Math.hypot(field.x - home.x, field.z - home.z));
  for (let i = 1; i < n; i++) {
    const x = Math.floor(home.x + ((field.x - home.x) * i) / n);
    const z = Math.floor(home.z + ((field.z - home.z) * i) / n);
    const y = Math.round(home.y + ((field.y - home.y) * i) / n);
    if (waterSurface(x, y, z, (p) => knownBlock(p)) !== null) return { x, y, z };
  }
  return null;
}

// --- Its bridge ------------------------------------------------------------------

/** Its bridge, as remembered. */
export function myBridge(): BridgePlan | null {
  const place = getPlaces("bridge")[0];
  const plan = place?.details?.["plan"] as BridgePlan | undefined;
  return plan ?? null;
}

/** Its bridge's deck is off limits to walks and collecting (like its shelter's walls). */
export function protectBridge(): void {
  const plan = myBridge();
  protectCells(plan ? deckCells(plan) : [], "bridge");
}

/** Deck cells with no block now (what's loaded; unknown counts as fine). */
function holes(plan: BridgePlan): Vec3[] {
  return deckCells(plan).filter((c) => {
    const b = knownBlock(c);
    return b !== null && b.boundingBox !== "block";
  });
}

// Where it last found no crossing narrow enough (a new swim tries again)
let noCrossingAt = -1;

/** True when there's nothing to do: no river it crosses by home, or its bridge is whole. */
export function bridgeDone(): boolean {
  const plan = myBridge();
  if (plan) return holes(plan).length === 0;
  const swims = swimsNearHome().length;
  return swims < SWIMS_WANTED || swims === noCrossingAt;
}

/** What to build with: cobblestone, else other stone, else planks. */
function deckMaterial(need: number): string | null {
  const count = (name: string): number => bot.inventory.items().filter((i) => i.name === name).reduce((n, i) => n + i.count, 0);
  for (const name of ["cobblestone", "cobbled_deepslate", "stone_bricks", "stone"]) if (count(name) >= need) return name;
  const planks = bot.inventory.items().filter((i) => catalog().isPlanks(i.name)).sort((a, b) => b.count - a.count)[0];
  return planks && count(planks.name) >= need ? planks.name : null;
}

/**
 * Builds (or mends) its bridge: plans the crossing first if there's none
 * yet. ok when it's whole, or when there's no crossing narrow enough here.
 */
export async function buildBridge(): Promise<ActionResult> {
  let plan = myBridge();
  if (!plan) {
    const swims = swimsNearHome();
    const field = await fieldAcrossWater();
    const centre = field ?? (swims.length ? { x: Math.round(swims.reduce((a, s) => a + s.x, 0) / swims.length), y: swims[swims.length - 1]!.y, z: Math.round(swims.reduce((a, s) => a + s.z, 0) / swims.length) } : null);
    if (!centre) return ok();
    plan = planCrossing(centre, (p) => knownBlock(p));
    if (!plan) {
      noCrossingAt = swims.length;
      chatter(`The river by my home is too wide for a bridge here (over ${MAX_SPAN} blocks); I'll keep swimming.`, "bridge");
      return ok();
    }
    await addPlace({ kind: "bridge", name: "bridge", ...plan.start, details: { plan } });
    protectBridge();
    console.log(`Bridge: ${plan.span} blocks across from (${plan.start.x}, ${plan.start.y}, ${plan.start.z}).`);
  }
  const missing = holes(plan);
  if (missing.length > 0) {
    let material = deckMaterial(missing.length);
    if (!material) {
      const { acquire } = await import("./acquire");
      const { liveWorld } = await import("./world");
      const got = await acquire("cobblestone", missing.length, liveWorld);
      if (!got.ok) return got;
      material = deckMaterial(missing.length);
      if (!material) return fail("missing_items", `not enough blocks for my bridge (${missing.length})`);
    }
    // Block by block forward from the first bank, standing on what's built
    const cells = deckCells(plan);
    for (let k = 0; k < plan.span; k++) {
      if (isCommandCancelled()) return fail("aborted", "stopped");
      const pair = [cells[2 * k]!, cells[2 * k + 1]!];
      if (pair.every((c) => knownBlock(c)?.boundingBox === "block")) continue;
      // Stand on the cell behind (the bank for the first)
      // (GoalNear: the bank may be a block higher than the deck)
      const back = new Vec3(plan.start.x - plan.step.dx * (1 - k), plan.start.y + 1, plan.start.z - plan.step.dz * (1 - k));
      const stood = await goTo(new pf.goals.GoalNear(back.x, back.y, back.z, 1));
      if (!stood.ok && isCommandCancelled()) return fail("aborted", "stopped");
      for (const c of pair) {
        if (knownBlock(c)?.boundingBox === "block") continue;
        const placed = await placeBlockResult(material, c.x, c.y, c.z, "side");
        if (!placed.ok && placed.reason !== "occupied") return placed;
      }
    }
  }
  // Torches where there are none yet (best effort)
  const torches = bot.inventory.items().some((i) => i.name === "torch");
  if (torches) for (const t of torchCells(plan)) if (knownBlock(t)?.name !== "torch" && isOpen(knownBlock(t))) await placeBlockResult("torch", t.x, t.y, t.z, "bottom");
  protectBridge();
  const left = holes(plan).length;
  if (left > 0) return fail("refused", `${left} blocks of my bridge didn't stay`);
  if (missing.length > 0) chatter(`Built a bridge over the river by my home (${plan.span} blocks), no more swimming.`, "bridge");
  return ok();
}
