// Only include imports that are actually used in this file
import { Vec3 } from "vec3";
import { bot } from "../core/body";
import pf from "mineflayer-pathfinder";
import { breakBlockAt, breakBlockAtResult, pickupNearbyItems, placeBlock, placeBlockResult } from "./worldInteraction";
import { goTo, knownBlock, useBlock } from "../core/primitives";
import { describeFailure, fail, ok, type ActionResult } from "../core/result";
import { report } from "../core/narrator";
import { catalog } from "../core/catalog";
import { isWoodenDoor } from "../core/movements";
import { forgetDoor, markDoor } from "../core/scaffold";
import { currentDimension } from "./perception";
import { TABLE_RANGE } from "./crafting";
import {
  addPlace,
  forgetPlaces,
  getBaseLocation,
  getPlaces,
  saveChestLocation,
  saveCraftingTableLocation,
  saveFurnaceLocation,
} from "../managers/persistenceManager";
import { digDiagonalTunnel, digDoorway, digRoom, tunnelBlocked, type DirectionType } from "./digging";
import { ensurePickaxe } from "./ensureTools";

// Helper function to place dirt if there's a hole
async function fillHole(pos: Vec3) {
  const dirt = bot.inventory.items().find((item) => item.name === "dirt");
  if (!dirt) {
    console.log("No dirt available to fill holes.");
    return;
  }

  const blockBelow = bot.blockAt(pos.offset(0, -1, 0));
  if (blockBelow && blockBelow.name === "air") {
    await placeBlock(
      dirt.name,
      blockBelow.position.x,
      blockBelow.position.y,
      blockBelow.position.z
    );

    console.log(`Filled hole at ${pos.toString()} with dirt.`);
  }
}

export async function clearSite(
  startPosition: Vec3,
  width: number = 6,
  length: number = 6,
  height: number = 4
) {
  // Clear and flatten the area
  for (let x = -Math.floor(width / 2); x <= Math.floor(width / 2); x++) {
    for (let z = -Math.floor(length / 2); z <= Math.floor(length / 2); z++) {
      for (let y = 0; y < height; y++) {
        const currentPos = startPosition.offset(x, y, z);
        const block = bot.blockAt(currentPos);

        if (block && block.name !== "air") {
          // Dig the block if it's not at ground level
          if (currentPos.y > startPosition.y) {
            await breakBlockAt(
              block.position.x,
              block.position.y,
              block.position.z
            );
            console.log(`Cleared block at ${currentPos.toString()}.`);
          }
        } else if (currentPos.y === startPosition.y) {
          // Fill the hole if it's at ground level
          await fillHole(currentPos);
        }
      }
    }
    await pickupNearbyItems(bot);
  }
}

// --- The shelter (the owner's design) ----------------------------------------------
// Stairs down (tunnelDepth levels, 5 high), an entrance doorway with a wooden
// door, a room (3 wide, 3 high, 5 long by default) with its walls, floor and
// ceiling made solid, and an exit doorway on the far side where the mine
// starts (skills/mine). setupTheShelter then puts in three double chests, a
// furnace and a crafting table; the bed goes along the wall by the table.
//
// Room offsets (across, along) from roomStart, facing into the room:
//
//   along 0: [chest] [stand] [chest]      <- entrance doorway behind
//   along 1: [chest] [  .  ] [chest]
//   along 2: [table] [  .  ] [furnace]
//   along 3: [ bed ] [  .  ] [chest]
//   along 4: [ bed ] [  .  ] [chest]
//                    [ exit doorway -> mine ]
//
// The middle column stays clear, from the entrance to the exit. The room's
// first middle cell (roomStart) is where it stands: never furnished, it's also
// what says the shelter still exists. Shut in at night, the door closed, the
// reflexes leave what's outside alone (core/sheltered).

export type RoomSize = { width: number; height: number; length: number };
export const DEFAULT_ROOM: RoomSize = { width: 3, height: 3, length: 5 };
export const DEFAULT_DEPTH = 4;
const STAIRS_HEIGHT = 4; // the diagonal tunnel's height parameter: 5 blocks of headroom
const BASE_NEAR = 64;
const FILLERS = ["cobblestone", "cobbled_deepslate", "dirt", "stone", "deepslate", "andesite", "diorite", "granite", "tuff"];
const DIRECTIONS: DirectionType[] = ["south", "east", "north", "west"]; // south first, as the original
const ALONG: Record<DirectionType, Vec3> = { north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), east: new Vec3(1, 0, 0), west: new Vec3(-1, 0, 0) };

type Pos = { x: number; y: number; z: number };
const plain = (p: Vec3): Pos => ({ x: p.x, y: p.y, z: p.z });

/** Every cell of the shelter from `start` going `dir` (pure: tested on its own). */
export function shelterPlan(start: Pos, dir: DirectionType, room: RoomSize = DEFAULT_ROOM, depth = DEFAULT_DEPTH) {
  const along = ALONG[dir];
  const across = new Vec3(Math.abs(along.z), 0, Math.abs(along.x));
  const s = new Vec3(start.x, start.y, start.z);
  const enter = s.plus(along.scaled(depth)).offset(0, -depth, 0); // the last stair
  const entrance = enter.plus(along); // the doorway (the door goes here)
  const roomStart = enter.plus(along.scaled(2));
  const cell = (x: number, z: number): Vec3 => roomStart.plus(across.scaled(x)).plus(along.scaled(z));
  const exit = cell(0, room.length); // the exit doorway: the mine's first step
  const stairs: Vec3[] = [];
  for (let i = 0; i <= depth; i++) for (let h = 0; h <= STAIRS_HEIGHT; h++) stairs.push(s.plus(along.scaled(i)).offset(0, -i + h, 0));
  const roomCells: Vec3[] = [];
  for (let z = 0; z < room.length; z++) for (let y = 0; y < room.height; y++) for (let x = -1; x < room.width - 1; x++) roomCells.push(cell(x, z).offset(0, y, 0));
  const doorways = [entrance, entrance.offset(0, 1, 0), exit, exit.offset(0, 1, 0)];
  return {
    enter,
    entrance,
    roomStart,
    exit,
    stand: roomStart,
    // Three double chests, a furnace and a table where setupTheShelter always put them
    chests: [cell(1, 0), cell(1, 1), cell(-1, 0), cell(-1, 1), cell(1, 3), cell(1, 4)],
    furnace: cell(1, 2),
    table: cell(-1, 2),
    // The bed along the wall: placed from the table's spot (before the table, or moving it)
    bed: cell(-1, 3),
    bedStand: cell(-1, 2),
    // Without a door: two blocks close the entrance doorway instead
    seal: [entrance, entrance.offset(0, 1, 0)],
    cells: [...stairs, ...doorways, ...roomCells],
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
function chooseSite(around: Vec3, room: RoomSize, depth: number): { start: Vec3; dir: DirectionType } | null {
  const spots = [around];
  for (const r of [6, 10]) for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) spots.push(around.offset(dx!, 0, dz!));
  for (const spot of spots) {
    let start: Vec3 | null = null;
    for (let dy = 4; dy >= -4 && !start; dy--) {
      const p = spot.offset(0, dy, 0);
      const here = bot.blockAt(p);
      const below = bot.blockAt(p.offset(0, -1, 0));
      if (here && below && here.boundingBox === "empty" && below.boundingBox === "block") start = p;
    }
    if (!start || underRoof(start)) continue;
    const dir = DIRECTIONS.find((d) => shelterPlan(start!, d, room, depth).cells.every((c) => tunnelBlocked(c) === null));
    if (dir) return { start, dir };
  }
  return null;
}

/** The latest shelter place in this dimension (finished or not). */
function shelterPlace(includeUnfinished: boolean) {
  const dim = currentDimension();
  return getPlaces("basement")
    .filter((p) => p.dimension === dim && (includeUnfinished || p.details?.["incomplete"] !== true))
    .at(-1);
}

/** A shelter it started digging and didn't finish (cut off, or the bot restarted). */
function unfinished(): { start: Vec3; dir: DirectionType } | null {
  const room = shelterPlace(true);
  if (room?.details?.["incomplete"] !== true) return null;
  const start = room.details["start"] as Pos | undefined;
  const dir = room.details["direction"] as DirectionType | undefined;
  if (!start || !dir || bot.entity.position.distanceTo(new Vec3(start.x, start.y, start.z)) > BASE_NEAR) return null;
  return { start: new Vec3(start.x, start.y, start.z), dir };
}

/** Saves the shelter (its stand cell, with every spot in it); `incomplete` until dug. */
async function saveShelter(start: Vec3, dir: DirectionType, room: RoomSize, depth: number, incomplete: boolean): Promise<void> {
  const plan = shelterPlan(start, dir, room, depth);
  const dim = currentDimension();
  await forgetPlaces((p) => p.kind === "basement" && p.dimension === dim && p.details?.["incomplete"] === true);
  await addPlace({
    kind: "basement",
    name: "shelter",
    dimension: dim,
    ...plain(plan.stand),
    details: {
      incomplete,
      start: plain(start),
      direction: dir,
      room,
      depth,
      door: plain(plan.entrance),
      seal: plan.seal.map(plain),
      exit: plain(plan.exit),
      chests: plan.chests.map(plain),
      furnace: plain(plan.furnace),
      table: plain(plan.table),
      bed: plain(plan.bed),
      bedStand: plain(plan.bedStand),
    },
  });
}

/**
 * Build a shelter to survive the night: at the base when it's close, else a
 * clear spot near here. A dig that was cut off carries on with the same stairs.
 * @param roomSize The size of the room to build.
 * @param tunnelDepth The depth of the tunnel to dig.
 */
export async function buildShelter(roomSize: RoomSize = DEFAULT_ROOM, tunnelDepth: number = DEFAULT_DEPTH): Promise<ActionResult> {
  if (shelterPlace(false)) {
    const known = shelterPlace(false)!;
    const block = bot.blockAt(new Vec3(known.x, known.y, known.z));
    if (!block || block.boundingBox !== "block") return ok(); // already have one (and it's still there)
  }
  console.log(`Building a shelter to survive the night...`);
  if (!(await ensurePickaxe())) return fail("no_tool", "no pickaxe to dig a shelter");

  let site = unfinished();
  if (!site) {
    const base = getBaseLocation();
    const baseHere = base && bot.entity.position.distanceTo(new Vec3(base.x, base.y, base.z)) <= BASE_NEAR;
    site = chooseSite(baseHere ? new Vec3(base.x, base.y, base.z).floored() : bot.entity.position.floored(), roomSize, tunnelDepth);
    if (!site) return fail("not_found", "no spot nearby with open sky and plain ground under it (water, lava or buildings everywhere)");
    await saveShelter(site.start, site.dir, roomSize, tunnelDepth, true);
  }
  const { start, dir } = site;
  const plan = shelterPlan(start, dir, roomSize, tunnelDepth);
  const walked = await goTo(new pf.goals.GoalBlock(start.x, start.y, start.z));
  if (!walked.ok) return walked;
  report("Digging a shelter for the night.");

  // Dig the diagonal tunnel
  if (!(await digDiagonalTunnel(dir, tunnelDepth, { width: 1, height: STAIRS_HEIGHT }, start, "basementEntrance"))) {
    return fail("refused", "the stairs hit lava, water or something built");
  }
  // Build a doorway at the entrance to basement (end of tunnel)
  await digDoorway(plan.enter, dir);
  // Create the room at the end of the tunnel
  await digRoom(plan.roomStart, roomSize, dir);
  // Make a doorway on another side of the room: the mine starts there
  await digDoorway(plan.exit.minus(ALONG[dir]), dir);
  await saveShelter(start, dir, roomSize, tunnelDepth, false);
  console.log(`Shelter dug: stairs from ${start} going ${dir}, room from ${plan.roomStart}, exit at ${plan.exit}.`);
  await putInDoor(plan.entrance);
  await pickupNearbyItems(bot);
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

/** Makes a wooden door and puts it in the entrance doorway (no door: the night seal is used instead). */
async function putInDoor(at: Vec3): Promise<void> {
  if (isWoodenDoor(knownBlock(at)?.name ?? "")) return;
  const carriedDoor = bot.inventory.items().find((i) => isWoodenDoor(i.name));
  const door = carriedDoor?.name ?? doorForMyWood();
  if (!carriedDoor) {
    const { acquire } = await import("../skills/acquire");
    const { liveWorld } = await import("../skills/world");
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

/** The spots in its shelter (null without one). */
export function shelterSlots(): {
  stand: Pos;
  chests: Pos[];
  furnace: Pos | null;
  table: Pos | null;
  bed: Pos | null;
  bedStand: Pos | null;
  exit: Pos | null;
  direction: DirectionType | null;
} | null {
  const room = shelterPlace(false);
  if (!room) return null;
  return {
    stand: { x: room.x, y: room.y, z: room.z },
    chests: cellsOf(room, "chests"),
    furnace: cellsOf(room, "furnace")[0] ?? null,
    table: cellsOf(room, "table")[0] ?? null,
    bed: cellsOf(room, "bed")[0] ?? null,
    bedStand: cellsOf(room, "bedStand")[0] ?? null,
    exit: cellsOf(room, "exit")[0] ?? null,
    direction: (room.details?.["direction"] as DirectionType | undefined) ?? null,
  };
}

/** Goes into the shelter (to the stand cell) and shuts the door, or closes the doorway with blocks. */
export async function enterShelter(): Promise<ActionResult> {
  const room = shelterPlace(false);
  if (!room) return fail("not_found", "no shelter");
  const walked = await goTo(new pf.goals.GoalBlock(room.x, room.y, room.z));
  if (!walked.ok) return walked;
  const doorAt = cellsOf(room, "door")[0];
  const door = doorAt ? knownBlock(doorAt) : null;
  if (door && isWoodenDoor(door.name)) {
    if (door.getProperties()["open"] === true) {
      const closed = await useBlock(door);
      if (!closed.ok) console.log(`Couldn't close my shelter door: ${describeFailure(closed)}`);
    }
    return ok();
  }
  for (const p of cellsOf(room, "seal")) {
    const here = knownBlock(p);
    if (!here) continue;
    if (here.boundingBox === "block") {
      markDoor(p, here.name); // already closed: still its door
      continue;
    }
    const filler = FILLERS.find((n) => bot.inventory.items().some((i) => i.name === n));
    if (!filler) return fail("missing_items", "nothing to close the doorway with");
    const placed = await placeBlockResult(filler, p.x, p.y, p.z, "side");
    // Its door: walking out ("come here" at night) may dig through it
    if (placed.ok) markDoor(p, placed.value.name);
  }
  return ok();
}

/** Opens a doorway closed with blocks again (in the morning); a wooden door just opens as it walks. */
export async function leaveShelter(): Promise<ActionResult> {
  const room = shelterPlace(false);
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

/** After a restart: blocks closing the doorway are its door again (the walking rules may break them). */
export function rememberShelterDoor(): void {
  const room = shelterPlace(false);
  if (!room) return;
  for (const p of cellsOf(room, "seal")) {
    const here = knownBlock(p);
    if (here && here.boundingBox === "block" && FILLERS.includes(here.name)) markDoor(p, here.name);
  }
}

/** True with a crafting table within `range` blocks. */
export function tableWithin(range: number): boolean {
  const id = bot.registry.blocksByName["crafting_table"]?.id;
  return id !== undefined && bot.findBlock({ matching: id, maxDistance: range }) !== null;
}

/** Puts `item` at `spot` (getting one first), unless it's already there. */
async function putAt(item: string, spot: Pos | null): Promise<ActionResult> {
  if (!spot) return ok();
  if (knownBlock(spot)?.name === item) return ok();
  if (!bot.inventory.items().some((i) => i.name === item)) {
    const { acquire } = await import("../skills/acquire");
    const { liveWorld } = await import("../skills/world");
    const got = await acquire(item, 1, liveWorld);
    if (!got.ok) return got;
  }
  const placed = await placeBlockResult(item, spot.x, spot.y, spot.z);
  return placed.ok ? ok() : placed;
}

/**
 * Furnishes the shelter: three double chests, a furnace and a crafting table
 * in their spots (remembered from now on). Stops at the first it can't get.
 */
export async function setupTheShelter(): Promise<ActionResult> {
  const slots = shelterSlots();
  if (!slots) {
    console.error("Basement location is undefined.");
    return fail("not_found", "no shelter to set up");
  }
  const inside = await goTo(new pf.goals.GoalBlock(slots.stand.x, slots.stand.y, slots.stand.z));
  if (!inside.ok) return inside;
  for (const spot of slots.chests) {
    const placed = await putAt("chest", spot);
    if (!placed.ok) return placed;
    await saveChestLocation(spot);
  }
  const furnace = await putAt("furnace", slots.furnace);
  if (!furnace.ok) return furnace;
  if (slots.furnace) await saveFurnaceLocation(slots.furnace);
  // A table only if there's none within 50 blocks (owner's rule: never a second one close by)
  if (!tableWithin(TABLE_RANGE)) {
    const table = await putAt("crafting_table", slots.table);
    if (!table.ok) return table;
    if (slots.table) await saveCraftingTableLocation(slots.table);
  }
  return ok();
}

export async function buildShack() {}
export async function buildWoodenHouse() {}
export async function buildStoneHouse() {}

// TBD
export async function buildCastle() {}
export async function buildFortress() {}
export async function buildTower() {}
