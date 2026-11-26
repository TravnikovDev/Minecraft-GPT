// Path: src/skills/lighting.ts
// A lit home (owner: creepers and zombies kept coming at the shelter because
// nothing around it was lit; a player lights the ground round the base).
// Hostile mobs spawn only where the block light is 0 (1.18+), and a torch's
// light reaches about 13 blocks (it drops by one per block), so a grid of
// torches on the ground around the shelter, a few blocks apart, stops them
// spawning there. Inside, a torch on the room's walls. Torches knocked out
// (a creeper) are put back the next time.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { goTo, knownBlock } from "../core/primitives";
import { fail, ok, type ActionResult } from "../core/result";
import { isCommandCancelled } from "../core/commandContext";
import { chatter } from "../core/narrator";
import { shelterLayout } from "../actions/building";
import { forbiddenAt } from "../core/forbidden";
import { isNatural, isProtected } from "../core/movements";

type P2 = { x: number; z: number };
type P3 = { x: number; y: number; z: number };

// The lit ground, in grades (owner: the first ring is too close to the
// shelter; then twice as far; then three times as far, sparser). Each grade:
// how far round the top of its stairs, a torch every `spacing` blocks, and
// how far up or down it looks for the ground (further out, the land varies more)
export type LightGrade = { radius: number; spacing: number; search: number };
export const LIGHT_GRADES: LightGrade[] = [
  { radius: 14, spacing: 7, search: 8 },
  { radius: 28, spacing: 7, search: 12 },
  { radius: 42, spacing: 12, search: 16 },
];
export const LIGHT_RADIUS = LIGHT_GRADES[0]!.radius;
export const LIGHT_SPACING = LIGHT_GRADES[0]!.spacing;
// A torch already this close (blocks) counts for a grid point
const TORCH_NEAR = 4;
// How far up and down from the stairs' top it looks for the ground at a grid point
const GROUND_SEARCH = 8;

/**
 * The grid points around `center`, `spacing` apart, out to `radius` (a
 * square). Pure.
 */
export function torchGrid(center: P2, radius = LIGHT_RADIUS, spacing = LIGHT_SPACING): P2[] {
  // Centred on the home: the grades' grids line up where they overlap
  const points: P2[] = [];
  const k = Math.floor(radius / spacing);
  for (let i = -k; i <= k; i++) {
    for (let j = -k; j <= k; j++) points.push({ x: center.x + i * spacing, z: center.z + j * spacing });
  }
  return points;
}

/** True when a torch is within `within` blocks (horizontally, and 4 up or down) of `p`. Pure. */
export function torchNear(p: P3, torches: P3[], within = TORCH_NEAR): boolean {
  return torches.some((t) => Math.abs(t.y - p.y) <= 4 && Math.hypot(t.x - p.x, t.z - p.z) <= within);
}

/** A cell as the ground search sees it (null: not loaded). */
export type GroundCell = { open: boolean; ground: boolean } | null;

/**
 * Where a torch stands on the ground at (x, z): the open cell (air, room
 * for it and the bot's head) over solid ground, nearest `y`. Null when the
 * column isn't loaded or there's no such cell (water, a cliff face). Pure
 * over `look`.
 */
export function groundSpot(x: number, z: number, y: number, look: (x: number, y: number, z: number) => GroundCell, search = GROUND_SEARCH): P3 | null {
  for (let d = 0; d <= search; d++) {
    for (const yy of d === 0 ? [y] : [y + d, y - d]) {
      const below = look(x, yy - 1, z);
      const cell = look(x, yy, z);
      const above = look(x, yy + 1, z);
      if (below?.ground && cell?.open && above?.open) return { x, y: yy, z };
    }
  }
  return null;
}

/** The live world's view for the ground search: open is air; ground is a full solid block that isn't leaves, glass, ice or a fluid. */
// What a torch goes in place of (cleared first): thin snow, grass, flowers
// (game test: in a snowy world every spot had a snow layer, no spot counted
// as open, and the home was "lit" with no torch out)
const SOFT = /^(snow|short_grass|grass|fern|dead_bush|dandelion|poppy|[a-z_]+_tulip|azure_bluet|oxeye_daisy|cornflower|allium|blue_orchid|lily_of_the_valley)$/;

function groundCellAt(x: number, y: number, z: number): GroundCell {
  const b = knownBlock(new Vec3(x, y, z));
  if (!b) return null;
  const open = b.name === "air" || b.name === "cave_air" || SOFT.test(b.name);
  // Natural ground only: never the owner's plank floor or roof, nor a field (review)
  const ground = b.boundingBox === "block" && isNatural(b.name) && !/leaves|ice$|^ice|farmland/.test(b.name);
  return { open, ground };
}

/** Torches it can see around `center` (both kinds). */
function torchesAround(center: Vec3, range: number): P3[] {
  const ids = ["torch", "wall_torch"].map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  return bot.findBlocks({ matching: ids, point: center, maxDistance: range, count: 256 }).map((p) => ({ x: p.x, y: p.y, z: p.z }));
}

type LightPlan = { inside: Array<{ cell: P3; side: string }>; outside: P3[]; unknown: number };

// Spots it couldn't light (no way there, the server said no): left for a
// while, and not counted against "lit" meanwhile (review: one unreachable
// spot, across a ravine, kept the milestone open for ever)
const FAILED_FOR_MS = 30 * 60_000;
const failedSpots = new Map<string, number>();
const spotKey = (p: P3): string => `${p.x},${p.y},${p.z}`;
const failedLately = (p: P3): boolean => (failedSpots.get(spotKey(p)) ?? 0) > Date.now();

const SIDE_NAMES: Array<[string, P3]> = [
  ["north", { x: 0, y: 0, z: -1 }],
  ["south", { x: 0, y: 0, z: 1 }],
  ["east", { x: 1, y: 0, z: 0 }],
  ["west", { x: -1, y: 0, z: 0 }],
];

/**
 * What lighting its home still needs: wall torches in the room (one near
 * each end: none within 4), and grid spots on the ground with no torch near.
 */
function lightPlan(grade = 0): LightPlan {
  const empty: LightPlan = { inside: [], outside: [], unknown: 0 };
  const home = shelterLayout();
  const g = LIGHT_GRADES[grade];
  if (!home || !bot.entity || !g) return empty;
  const top = new Vec3(home.start.x, home.start.y, home.start.z);
  const torches = torchesAround(top, g.radius + 8);
  const shell = new Set(home.shell.map((c) => `${c.x},${c.y},${c.z}`));
  // Inside: the room's cells at head height, with a wall of the shell beside them
  const inside: LightPlan["inside"] = [];
  const headCells = home.room.filter((c) => c.y === Math.min(...home.room.map((r) => r.y)) + 1);
  // (the room with the first grade only)
  for (const cell of grade === 0 ? [headCells[0], headCells.at(-1)] : []) {
    if (!cell || torchNear(cell, torches.concat(inside.map((i) => i.cell)), 3)) continue;
    const open = knownBlock(cell);
    if (!open || (open.name !== "air" && open.name !== "cave_air")) continue;
    const side = SIDE_NAMES.find(([, d]) => {
      const w = { x: cell.x + d.x, y: cell.y, z: cell.z + d.z };
      return shell.has(`${w.x},${w.y},${w.z}`) && knownBlock(new Vec3(w.x, w.y, w.z))?.boundingBox === "block";
    });
    if (side) inside.push({ cell: { x: cell.x, y: cell.y, z: cell.z }, side: side[0] });
  }
  // Outside: the grid on the ground round the top of its stairs
  const outside: P3[] = [];
  let unknown = 0;
  for (const p of torchGrid({ x: home.start.x, z: home.start.z }, g.radius, g.spacing)) {
    // Not loaded: not known to be lit (only "lit" when every spot was seen)
    if (!knownBlock(new Vec3(p.x, home.start.y, p.z))) {
      unknown++;
      continue;
    }
    const spot = groundSpot(p.x, p.z, home.start.y, groundCellAt, g.search);
    if (!spot || shell.has(`${spot.x},${spot.y},${spot.z}`)) continue;
    // Never where it must keep out or keeps (its shelter, its stairs), nor a spot it just failed at
    const v = new Vec3(spot.x, spot.y, spot.z);
    if (forbiddenAt(v) || isProtected(spot) || isProtected({ ...spot, y: spot.y - 1 }) || failedLately(spot)) continue;
    if (!torchNear(spot, torches)) outside.push(spot);
  }
  return { inside, outside, unknown };
}

// lit() is asked whenever the next milestone is looked for: kept a while (per grade)
const litCache = new Map<number, { at: number; lit: boolean }>();
const LIT_CACHE_MS = 20_000;

/** True when its home is lit to this grade, inside and round about (as far as it can see). */
export function homeLit(grade = 0): boolean {
  const cached = litCache.get(grade);
  if (cached && Date.now() - cached.at < LIT_CACHE_MS) return cached.lit;
  const plan = lightPlan(grade);
  const lit = plan.inside.length === 0 && plan.outside.length === 0;
  litCache.set(grade, { at: Date.now(), lit });
  return lit;
}

/** True when every spot of this grade has been seen and is lit (for the announcement: never "lit" for land it hasn't seen). */
export function homeLitSeen(grade = 0): boolean {
  const plan = lightPlan(grade);
  return plan.inside.length === 0 && plan.outside.length === 0 && plan.unknown === 0;
}

/** Torches it needs for what's dark now at this grade. */
export function torchesNeeded(grade = 0): number {
  const plan = lightPlan(grade);
  return plan.inside.length + plan.outside.length;
}

/**
 * Lights its home: the room's walls first, then (by day: out at night is
 * where the mobs are) the ground round it. Crafts torches as it goes. A
 * spot it can't light (no way there, the server says no) is left; the rest
 * still get theirs.
 */
export async function lightUpHome(byDay: boolean, grade = 0): Promise<ActionResult> {
  const { torchReady } = await import("../actions/digging");
  const { placeBlockResult } = await import("../actions/blockPlacing");
  const plan = lightPlan(grade);
  let placed = 0;
  let missed = 0;
  const ready = async (): Promise<boolean> => {
    const r = await torchReady();
    if (r !== true) console.log(`Lighting: ${r}.`);
    return r === true;
  };
  for (const { cell, side } of plan.inside) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    if (!(await ready())) return fail("missing_items", "no torches to light my home with");
    // The wall it goes on is the side named; placeOn is the face it's put against
    const got = await placeBlockResult("torch", cell.x, cell.y, cell.z, side);
    if (got.ok) placed++;
    else missed++;
  }
  if (byDay) {
    for (const spot of plan.outside) {
      if (isCommandCancelled()) return fail("aborted", "stopped");
      if (!(await ready())) break;
      const there = await goTo(new pf.goals.GoalNear(spot.x, spot.y, spot.z, 3));
      if (!there.ok) {
        missed++;
        failedSpots.set(spotKey(spot), Date.now() + FAILED_FOR_MS);
        continue;
      }
      // Thin snow or a plant there: cleared first
      const there2 = knownBlock(new Vec3(spot.x, spot.y, spot.z));
      if (there2 && SOFT.test(there2.name)) {
        const { breakBlock } = await import("../core/primitives");
        await breakBlock(there2.position, { allowWithoutHarvest: true });
      }
      const got = await placeBlockResult("torch", spot.x, spot.y, spot.z, "bottom");
      if (got.ok) placed++;
      else {
        missed++;
        failedSpots.set(spotKey(spot), Date.now() + FAILED_FOR_MS);
      }
    }
  }
  litCache.delete(grade);
  if (placed > 0) chatter(`Put up ${placed} torch${placed === 1 ? "" : "es"} round my home${grade > 0 ? `, out to ${LIGHT_GRADES[grade]!.radius} blocks` : ""}, so nothing spawns by it.`, "lighting");
  if (homeLit(grade)) return ok();
  if (!byDay && plan.outside.length > 0) return fail("refused", "the ground round my home is lit by day");
  // Lighting some shows others (a spot it couldn't see from inside): said as what's left
  const left = torchesNeeded(grade);
  if (missed === 0) return fail("not_found", `${left} more spot${left === 1 ? "" : "s"} round my home to light`);
  return fail("not_found", `${missed} spot${missed === 1 ? "" : "s"} round my home I couldn't light`);
}
