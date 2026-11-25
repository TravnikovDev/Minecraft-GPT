// Path: src/skills/shelter.ts
// A first shelter, like a player's first night (Phase 6): a staircase down
// (the stone it digs is the cobblestone for stone tools), a corridor 3 long
// with a wooden door in the middle, then a room 3 wide, 3 long and 2 high.
// Mobs can't open a wooden door, and the bot walks through it (it opens doors
// on its route and closes them behind it), so at night it just goes in. With
// no door (no wood to make one) it closes the corridor with two blocks from
// inside instead, and opens them again in the morning.
//
// The room has fixed spots, so furniture never lands where it stands:
//
//   stairs -> [ . ] [door] [ . ] [stand] [bed foot] [bed head]   (the middle column)
//                                 [  .  ] [   .    ] [ chest  ]   (each side column)
//
// The stand cell is never furnished, so it is also what says the shelter is
// still there. Where: open sky (not inside a house), every cell natural stone
// or dirt (no water, lava or anything built), near the base when it has one.
// The place is saved before digging (incomplete), so a dig that's cut off
// carries on with the same stairs instead of starting new ones.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { goTo, knownBlock, useBlock } from "../core/primitives";
import { catalog } from "../core/catalog";
import { isWoodenDoor } from "../core/movements";
import { describeFailure } from "../core/result";
import { fail, ok, type ActionResult } from "../core/result";
import { report } from "../core/narrator";
import { markDoor, forgetDoor } from "../core/scaffold";
import { addPlace, forgetPlaces, getBaseLocation, getPlaces } from "../managers/persistenceManager";
import { currentDimension } from "../actions/perception";
import { digDiagonalTunnel, digStraightTunnel, tunnelBlocked, type DirectionType } from "../actions/digging";
import { breakBlockAtResult, placeBlockResult } from "../actions/worldInteraction";
import { ensurePickaxe } from "../actions/ensureTools";
import { shelter } from "./capabilities";

const DEPTH = 5;
const CORRIDOR = 3;
const ROOM_LENGTH = 3;
const BASE_NEAR = 64;
const FILLERS = ["cobblestone", "cobbled_deepslate", "dirt", "stone", "deepslate", "andesite", "diorite", "granite", "tuff"];
const STEP: Record<DirectionType, { x: number; z: number }> = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };
const DIRECTIONS: DirectionType[] = ["north", "east", "south", "west"];

type Pos = { x: number; y: number; z: number };
const plain = (p: Vec3): Pos => ({ x: p.x, y: p.y, z: p.z });

/** The shape of a shelter dug from `start` going `dir` (pure: tested on its own). */
export function shelterLayout(start: Pos, dir: DirectionType) {
  const s = STEP[dir];
  const fwd = (p: Vec3, n: number): Vec3 => p.offset(s.x * n, 0, s.z * n);
  // Across the room: x for a north/south room, z for east/west
  const side = new Vec3(Math.abs(s.z), 0, Math.abs(s.x));
  const bottom = new Vec3(start.x + s.x * DEPTH, start.y - DEPTH, start.z + s.z * DEPTH);
  const stairs: Vec3[] = [];
  for (let i = 0; i <= DEPTH; i++) for (let h = 0; h <= 2; h++) stairs.push(new Vec3(start.x + s.x * i, start.y - i + h, start.z + s.z * i));
  const corridor: Vec3[] = [];
  for (let i = 1; i <= CORRIDOR; i++) for (let h = 0; h <= 1; h++) corridor.push(fwd(bottom, i).offset(0, h, 0));
  // The room starts after the corridor
  const roomStart = fwd(bottom, CORRIDOR);
  const room: Vec3[] = [];
  for (let row = 1; row <= ROOM_LENGTH; row++) for (let w = -1; w <= 1; w++) for (let h = 0; h <= 1; h++) room.push(fwd(roomStart, row).plus(side.scaled(w)).offset(0, h, 0));
  const door = fwd(bottom, 2); // the corridor's middle: room to stand on both sides
  return {
    bottom,
    roomStart,
    door,
    // Without a door: two blocks close the corridor there instead
    seal: [door, door.offset(0, 1, 0)],
    // Where it stands (first row, middle): never furnished
    stand: fwd(roomStart, 1),
    // The bed's foot (it's placed facing on, so the head goes in the last row)
    bed: fwd(roomStart, 2),
    chests: [fwd(roomStart, 3).plus(side), fwd(roomStart, 3).minus(side)],
    // Every cell dug, for checking the site first
    cells: [...stairs, ...corridor, ...room],
  };
}

/** True with blocks overhead within 12 (a roof: it's inside a house or a cave). */
function underRoof(p: Vec3): boolean {
  for (let dy = 2; dy <= 12; dy++) {
    const b = bot.blockAt(p.offset(0, dy, 0));
    if (b && b.boundingBox === "block") return true;
  }
  return false;
}

/** The first spot and direction where the whole shelter can be dug (natural ground, no water or lava). */
function chooseSite(around: Vec3): { start: Vec3; dir: DirectionType } | null {
  const spots = [around];
  for (const r of [6, 10]) for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) spots.push(around.offset(dx!, 0, dz!));
  for (const spot of spots) {
    // Stand on the ground there: the first air with something solid under it, near this height
    let start: Vec3 | null = null;
    for (let dy = 4; dy >= -4 && !start; dy--) {
      const p = spot.offset(0, dy, 0);
      const here = bot.blockAt(p);
      const below = bot.blockAt(p.offset(0, -1, 0));
      if (here && below && here.boundingBox === "empty" && below.boundingBox === "block") start = p;
    }
    if (!start || underRoof(start)) continue;
    const dir = DIRECTIONS.find((d) => shelterLayout(start!, d).cells.every((c) => tunnelBlocked(c) === null));
    if (dir) return { start, dir };
  }
  return null;
}

/** A shelter it started digging and didn't finish (cut off, or the bot restarted). */
function unfinished(): { start: Vec3; dir: DirectionType } | null {
  const dim = currentDimension();
  const room = getPlaces("basement").find((p) => p.dimension === dim && p.details?.["incomplete"] === true);
  const start = room?.details?.["start"] as Pos | undefined;
  const dir = room?.details?.["direction"] as DirectionType | undefined;
  if (!start || !dir || bot.entity.position.distanceTo(new Vec3(start.x, start.y, start.z)) > BASE_NEAR) return null;
  return { start: new Vec3(start.x, start.y, start.z), dir };
}

/** Saves the shelter: `incomplete` until both digs are done. */
async function saveShelter(start: Vec3, dir: DirectionType, incomplete: boolean): Promise<void> {
  const layout = shelterLayout(start, dir);
  const dim = currentDimension();
  await forgetPlaces((p) => p.kind === "basement" && p.dimension === dim && p.details?.["incomplete"] === true);
  await addPlace({
    kind: "basement",
    name: "shelter",
    dimension: dim,
    ...plain(layout.stand),
    details: {
      incomplete,
      start: plain(start),
      direction: dir,
      seal: layout.seal.map(plain),
      door: plain(layout.door),
      bed: plain(layout.bed),
      chests: layout.chests.map(plain),
    },
  });
}

/** Digs the shelter (stairs and room) and remembers it. */
export async function buildShelter(): Promise<ActionResult> {
  if (shelter()) return ok();
  if (!(await ensurePickaxe())) return fail("no_tool", "no pickaxe to dig a shelter");
  let site = unfinished();
  if (!site) {
    // Near its base when it has one close by, else where it is
    const base = getBaseLocation();
    const baseHere = base && bot.entity.position.distanceTo(new Vec3(base.x, base.y, base.z)) <= BASE_NEAR;
    site = chooseSite(baseHere ? new Vec3(base.x, base.y, base.z).floored() : bot.entity.position.floored());
    if (!site) return fail("not_found", "no spot nearby with open sky and plain ground under it (water, lava or buildings everywhere)");
    await saveShelter(site.start, site.dir, true);
  }
  const { start, dir } = site;
  const walked = await goTo(new pf.goals.GoalBlock(start.x, start.y, start.z));
  if (!walked.ok) return walked;
  const layout = shelterLayout(start, dir);
  report("Digging a shelter for the night.");
  if (!(await digDiagonalTunnel(dir, DEPTH, { width: 1, height: 2 }, start, "basementEntrance"))) {
    return fail("refused", "the stairs hit lava, water or something built");
  }
  if (!(await digStraightTunnel(dir, CORRIDOR, layout.bottom, 1))) return fail("refused", "the corridor hit lava, water or something built");
  if (!(await digStraightTunnel(dir, ROOM_LENGTH, layout.roomStart, 3))) return fail("refused", "the room hit lava, water or something built");
  await saveShelter(start, dir, false);
  console.log(`Shelter dug: stairs from ${start} going ${dir}, room at ${layout.stand}.`);
  await putInDoor(layout.door);
  return ok();
}

/** The wooden door for the wood it carries most of (acacia logs -> acacia_door). */
function doorForMyWood(): string {
  const c = catalog();
  const wood = bot.inventory
    .items()
    .filter((i) => c.isLog(i.name) || c.isPlanks(i.name))
    .sort((a, b) => b.count - a.count)
    .map((i) => (c.isPlanks(i.name) ? i.name : c.planksFor(i.name) ?? ""))
    .map((planks) => planks.replace(/_planks$/, "_door"))
    .find((door) => bot.registry.itemsByName[door] !== undefined);
  return wood ?? "oak_door";
}

/** Makes a wooden door and puts it in the corridor (no door: the night seal is used instead). */
async function putInDoor(at: Vec3): Promise<void> {
  if (isWoodenDoor(knownBlock(at)?.name ?? "")) return;
  const carriedDoor = bot.inventory.items().find((i) => isWoodenDoor(i.name));
  const door = carriedDoor?.name ?? doorForMyWood();
  if (!carriedDoor) {
    const { acquire } = await import("./acquire");
    const { liveWorld } = await import("./world");
    const made = await acquire(door, 1, liveWorld);
    if (!made.ok) {
      console.log(`No door for the shelter (${describeFailure(made)}); I'll close it with blocks at night.`);
      return;
    }
  }
  const placed = await placeBlockResult(door, at.x, at.y, at.z);
  console.log(placed.ok ? `Put a door in my shelter at ${at}.` : `Couldn't put the door in (${describeFailure(placed)}); I'll close it with blocks at night.`);
}

const cellsOf = (room: { details?: Record<string, unknown> }, key: string): Pos[] => {
  const v = room.details?.[key];
  return Array.isArray(v) ? (v as Pos[]) : v ? [v as Pos] : [];
};

/** Where the bed and the chests go in its shelter (null without one). */
export function shelterSlots(): { stand: Pos; bed: Pos | null; chests: Pos[] } | null {
  const room = shelter();
  if (!room) return null;
  return { stand: { x: room.x, y: room.y, z: room.z }, bed: cellsOf(room, "bed")[0] ?? null, chests: cellsOf(room, "chests") };
}

/** Goes into the shelter (to the stand cell) and seals the stairs behind it. */
export async function enterShelter(): Promise<ActionResult> {
  const room = shelter();
  if (!room) return fail("not_found", "no shelter");
  const walked = await goTo(new pf.goals.GoalBlock(room.x, room.y, room.z));
  if (!walked.ok) return walked;
  // A door: shut it (the door opener usually has already, once it was through)
  const doorAt = cellsOf(room, "door")[0];
  const door = doorAt ? knownBlock(doorAt) : null;
  if (door && isWoodenDoor(door.name)) {
    if (door.getProperties()["open"] === true) {
      const closed = await useBlock(door);
      if (!closed.ok) console.log(`Couldn't close my shelter door: ${describeFailure(closed)}`);
    }
    return ok();
  }
  // No door: close the corridor (or, in an older shelter, the stairs) with blocks
  for (const p of cellsOf(room, "seal")) {
    const here = knownBlock(p);
    if (!here) continue;
    if (here.boundingBox === "block") {
      markDoor(p, here.name); // already closed: still its door
      continue;
    }
    const filler = FILLERS.find((n) => bot.inventory.items().some((i) => i.name === n));
    if (!filler) return fail("missing_items", "nothing to seal the door with");
    const placed = await placeBlockResult(filler, p.x, p.y, p.z, "side");
    // Its door: walking out ("come here" at night) may dig through it
    if (placed.ok) markDoor(p, placed.value.name);
  }
  return ok();
}

/** Opens the sealed stairs again (in the morning). */
export async function leaveShelter(): Promise<ActionResult> {
  const room = shelter();
  if (!room) return ok();
  for (const p of cellsOf(room, "seal")) {
    const here = knownBlock(p);
    // Only its own blocks: never the door, never anything else
    if (!here || here.boundingBox !== "block" || !FILLERS.includes(here.name)) continue;
    const broken = await breakBlockAtResult(p.x, p.y, p.z);
    if (!broken.ok) return broken;
    forgetDoor(p);
  }
  return ok();
}

/** After a restart: the seal blocks still standing are its door again. */
export function rememberShelterDoor(): void {
  const room = shelter();
  if (!room) return;
  for (const p of cellsOf(room, "seal")) {
    const here = knownBlock(p);
    if (here && here.boundingBox === "block" && FILLERS.includes(here.name)) markDoor(p, here.name);
  }
}
