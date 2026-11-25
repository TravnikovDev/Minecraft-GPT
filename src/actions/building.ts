// Only include imports that are actually used in this file
import { Vec3 } from "vec3";
import { bot } from "../core/body";
import pf from "mineflayer-pathfinder";
import { breakBlockAt, breakBlockAtResult, pickupNearbyItems, placeBlock, placeBlockResult } from "./worldInteraction";
import { goTo, knownBlock, useBlock, withinReach } from "../core/primitives";
import { describeFailure, fail, ok, type ActionResult } from "../core/result";
import { report } from "../core/narrator";
import { isCommandCancelled } from "../core/commandContext";
import { catalog } from "../core/catalog";
import { isWoodenDoor, protectCells, setOwnPassages } from "../core/movements";
import { forgetDoor, markDoor } from "../core/scaffold";
import { currentDimension } from "./perception";
import { collectBlock } from "./collectBlock";
import {
  addPlace,
  forgetPlaces,
  getBaseLocation,
  getMemory,
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
    // Around the room: its walls, roof and floor (the doorways left open).
    // These must be solid ground, or it isn't really a shelter (a hillside
    // left its roof open to the sky, fresh-world test)
    shell: shellAround(roomCells, doorways),
  };
}

const cellKey = (p: Pos): string => `${p.x},${p.y},${p.z}`;
const NEIGHBOURS = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

/** Every cell next to the room that isn't the room or a doorway. */
function shellAround(room: Vec3[], doorways: Vec3[]): Vec3[] {
  const inside = new Set([...room, ...doorways].map(cellKey));
  const shell = new Map<string, Vec3>();
  for (const c of room) for (const n of NEIGHBOURS) {
    const p = c.plus(n);
    if (!inside.has(cellKey(p))) shell.set(cellKey(p), p);
  }
  return [...shell.values()];
}

const FALLING = new Set(["sand", "red_sand", "gravel", "suspicious_sand", "suspicious_gravel"]);
type BlockAt = (p: Vec3) => { name: string; boundingBox: string } | null;

/**
 * True when the shell is solid ground: every wall, roof and floor cell a full
 * block, nothing that falls (sand, gravel) in the roof, no liquid (pure: tested
 * with a made-up world). Unloaded cells count as unknown, so not good.
 */
export function shellIsSolid(shell: Vec3[], roofY: number, blockAt: BlockAt): boolean {
  return shellGaps(shell, roofY, blockAt) === 0;
}

/**
 * A tree's blocks are no wall or roof: leaves rot away once the tree is
 * gone, and logs get chopped (owner: a roof of logs and leaves isn't a
 * shelter). They're broken out and built over with dirt or stone.
 */
export const isTreeBlock = (name: string): boolean => /_leaves$|_log$|_wood$|_stem$|_hyphae$/.test(name);

/** How many shell cells need building (open, a tree's leaves or logs, or sand and gravel in the roof that would fall in). */
export function shellGaps(shell: Vec3[], roofY: number, blockAt: BlockAt): number {
  return shell.filter((p) => {
    const b = blockAt(p);
    if (!b || b.boundingBox !== "block" || isTreeBlock(b.name)) return true;
    return p.y >= roofY && FALLING.has(b.name);
  }).length;
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
  for (const r of [6, 10, 16]) for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) spots.push(around.offset(dx!, 0, dz!));
  // Any spot it can dig (no water, lava or buildings) will do: missing walls,
  // roof and floor get built (patchShell). Among them, the one with the least
  // to build, preferring the closest when it's a tie (owner: there won't
  // always be a perfect spot)
  let best: { start: Vec3; dir: DirectionType; gaps: number } | null = null;
  for (const spot of spots) {
    let start: Vec3 | null = null;
    for (let dy = 4; dy >= -4 && !start; dy--) {
      const p = spot.offset(0, dy, 0);
      const here = bot.blockAt(p);
      const below = bot.blockAt(p.offset(0, -1, 0));
      if (here && below && here.boundingBox === "empty" && below.boundingBox === "block") start = p;
    }
    if (!start || underRoof(start)) continue;
    for (const dir of DIRECTIONS) {
      const plan = shelterPlan(start, dir, room, depth);
      if (!plan.cells.every((c) => tunnelBlocked(c) === null)) continue;
      const gaps = shellGaps(plan.shell, plan.roomStart.y + room.height, (p) => bot.blockAt(p));
      if (!best || gaps < best.gaps) best = { start, dir, gaps };
    }
    if (best?.gaps === 0) break; // can't do better than solid ground all round
  }
  if (best && best.gaps > 0) console.log(`Shelter site at ${best.start} going ${best.dir}: ${best.gaps} blocks of wall, roof or floor to build.`);
  return best ? { start: best.start, dir: best.dir } : null;
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

/** Counts a failed patch on the unfinished shelter; returns how many so far. */
async function noteFailedPatch(start: Vec3, dir: DirectionType, room: RoomSize, depth: number): Promise<number> {
  const tries = ((shelterPlace(true)?.details?.["patchTries"] as number | undefined) ?? 0) + 1;
  await saveShelter(start, dir, room, depth, true, tries);
  return tries;
}

/** Saves the shelter (its stand cell, with every spot in it); `incomplete` until dug. */
async function saveShelter(start: Vec3, dir: DirectionType, room: RoomSize, depth: number, incomplete: boolean, patchTries = 0): Promise<void> {
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
      patchTries,
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
    // Already have one (and it's still there): mend it if it needs it
    if (!block || block.boundingBox !== "block") return shelterIntact() ? ok() : repairShelter();
  }
  console.log(`Building a shelter to survive the night...`);
  if (!(await ensurePickaxe())) return fail("no_tool", "no pickaxe to dig a shelter");

  let site = unfinished();
  const resuming = site !== null;
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
  if (!resuming) report("Digging a shelter for the night.");

  // Already dug out (a retry after patching failed): straight to patching
  const dugOut = resuming && plan.cells.every((c) => knownBlock(c)?.boundingBox === "empty");
  if (!dugOut) {
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
  }
  // Pick up what it dug (the dirt and stone to patch with), then make the
  // shell solid, and only then count the shelter as done; otherwise the next
  // try carries on at the same spot
  await pickupNearbyItems(bot);
  // Short of filler for the gaps: dirt it can see first
  const gaps = plan.shell.filter((p) => knownBlock(p) && (knownBlock(p)!.boundingBox !== "block" || isTreeBlock(knownBlock(p)!.name))).length;
  const filler = bot.inventory.items().filter((i) => PATCH_FILLERS.includes(i.name) || catalog().isPlanks(i.name)).reduce((c, i) => c + i.count, 0);
  if (gaps > filler) await collectBlock("dirt", gaps - filler + 4, 16, { seenOnly: true });
  const patched = await patchShell(plan.shell);
  if (!patched.ok) {
    // Twice and still gaps: this site won't do; the next try picks another
    const tries = await noteFailedPatch(start, dir, roomSize, tunnelDepth);
    if (tries >= 2) {
      const dim = currentDimension();
      await forgetPlaces((p) => p.kind === "basement" && p.dimension === dim && p.details?.["incomplete"] === true);
      console.log(`Shelter at ${start} couldn't be closed up after ${tries} tries; I'll pick another spot.`);
    }
    return patched;
  }
  await saveShelter(start, dir, roomSize, tunnelDepth, false);
  protectShelter();
  console.log(`Shelter dug: stairs from ${start} going ${dir}, room from ${plan.roomStart}, exit at ${plan.exit}.`);
  await putInDoor(plan.entrance);
  // And one in the back doorway, to the mine: what comes up the mine stays out
  await putInDoor(plan.exit);
  await pickupNearbyItems(bot);
  return ok();
}

/** Its finished shelter's plan (null without one). */
function myShelterPlan(): { room: NonNullable<ReturnType<typeof shelterPlace>>; plan: ReturnType<typeof shelterPlan> } | null {
  const room = shelterPlace(false);
  const start = room?.details?.["start"] as Pos | undefined;
  const dir = room?.details?.["direction"] as DirectionType | undefined;
  if (!room || !start || !dir) return null;
  const plan = shelterPlan(start, dir, (room.details?.["room"] as RoomSize | undefined) ?? DEFAULT_ROOM, (room.details?.["depth"] as number | undefined) ?? DEFAULT_DEPTH);
  return { room, plan };
}

/** A shell cell that needs building: open, or a tree's leaves or log (one holding up sand or gravel stays). */
function shellHole(p: Vec3): boolean {
  const b = knownBlock(p);
  if (!b) return false; // not loaded: nothing to say
  // Open (air or liquid); a torch or a ladder on the wall isn't a hole
  if (["air", "cave_air", "void_air", "water", "lava"].includes(b.name)) return true;
  if (b.boundingBox !== "block") return false;
  return isTreeBlock(b.name) && !FALLING.has(knownBlock(p.offset(0, 1, 0))?.name ?? "");
}

/**
 * True when its shelter is as the plan says now: walls, roof and floor
 * solid, a wooden door in both doorways (the entrance, and the back one to
 * the mine). What it can't see (not loaded) counts as fine. Owner: after a
 * creeper blows a wall out, or when a new version of the plan adds
 * something (the mine door), it notices and fixes it.
 */
export function shelterIntact(): boolean {
  const mine = myShelterPlan();
  if (!mine) return true;
  const { plan } = mine;
  if (plan.shell.some(shellHole)) return false;
  for (const at of [plan.entrance, plan.exit]) {
    const b = knownBlock(at);
    if (b && !isWoodenDoor(b.name)) return false;
  }
  return true;
}

/** Goes home and mends the shelter: fills holes in its walls, roof and floor, and puts in any missing door. */
async function repairShelter(): Promise<ActionResult> {
  const mine = myShelterPlan();
  if (!mine) return ok();
  const { room, plan } = mine;
  const holes = plan.shell.filter(shellHole).length;
  const doors = [plan.entrance, plan.exit].filter((at) => !isWoodenDoor(knownBlock(at)?.name ?? "")).length;
  report(`Fixing my shelter: ${[holes ? `${holes} blocks of wall, roof or floor` : "", doors ? `${doors} door${doors > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and ")}.`);
  const home = await walkHome(room);
  if (!home.ok) return home;
  if (holes > 0) {
    const filler = bot.inventory.items().filter((i) => PATCH_FILLERS.includes(i.name) || catalog().isPlanks(i.name)).reduce((c, i) => c + i.count, 0);
    if (holes > filler) await collectBlock("dirt", holes - filler + 4, 16, { seenOnly: true });
    const patched = await patchShell(plan.shell);
    if (!patched.ok) return patched;
  }
  for (const at of [plan.entrance, plan.exit]) await putInDoor(at);
  protectShelter();
  return shelterIntact() ? ok() : fail("refused", "my shelter still isn't whole");
}

// What it patches walls with: dirt first (stone and wood are for tools)
// What it builds missing walls, roof and floor with: dirt, any stone, then
// wood (owner: any of these does; there won't always be a perfect spot)
const PATCH_FILLERS = ["dirt", "coarse_dirt", "cobblestone", "cobbled_deepslate", "andesite", "diorite", "granite", "tuff", "netherrack"];
const fillerFor = (): string | null =>
  PATCH_FILLERS.find((n) => bot.inventory.items().some((i) => i.name === n)) ??
  bot.inventory.items().find((i) => catalog().isPlanks(i.name))?.name ??
  null;

/**
 * Fills every gap in the shell, from the ones next to something solid
 * outwards (a gap in the roof over open air has nothing to be placed
 * against until its neighbour is filled). Fails, naming the gaps, if it runs
 * out of filler or can't place.
 */
async function patchShell(shell: Vec3[]): Promise<ActionResult> {
  // A tree's leaves and logs count as gaps: each is broken out and built over
  // in one go when its turn comes (placing breaks what's in the way), so
  // running out of filler never leaves more holes than there were. A log
  // with sand or gravel on it stays: breaking it drops that into the room.
  const holdsUpFalling = (p: Vec3): boolean => FALLING.has(knownBlock(p.offset(0, 1, 0))?.name ?? "");
  const solid = (p: Vec3): boolean => {
    const b = knownBlock(p);
    return b?.boundingBox === "block" && (!isTreeBlock(b.name) || holdsUpFalling(p));
  };
  // A hillside's open side goes up from the floor a layer per pass, then the roof closes in
  for (let pass = 0; pass < 12; pass++) {
    const gaps = shell.filter((p) => knownBlock(p) && !solid(p));
    if (gaps.length === 0) return ok();
    // This pass: gaps that have a solid neighbour to place against
    const placeable = gaps.filter((p) => NEIGHBOURS.some((n) => solid(p.plus(n))));
    if (placeable.length === 0) break;
    for (const p of placeable) {
      if (isCommandCancelled()) return fail("aborted", "stopped");
      let filler = fillerFor();
      // Out of dirt and stone: planks from a log it carries
      if (!filler && bot.inventory.items().some((i) => catalog().isLog(i.name))) {
        const log = bot.inventory.items().find((i) => catalog().isLog(i.name))!;
        const planks = catalog().planksFor(log.name);
        if (planks) {
          const { craftNow } = await import("./craftPlanner");
          await craftNow(planks, 4);
        }
        filler = fillerFor();
      }
      if (!filler) return fail("missing_items", `nothing to build my shelter's walls with (${gaps.length} gaps)`);
      const placed = await placeBlockResult(filler, p.x, p.y, p.z, "side");
      if (!placed.ok) console.log(`Couldn't fill the shelter wall at ${p}: ${describeFailure(placed)}`);
    }
  }
  const left = shell.filter((p) => knownBlock(p) && !solid(p));
  if (left.length > 0) return fail("refused", `my shelter's walls still have ${left.length} gaps (first at ${left[0]})`);
  console.log("Shelter walls, roof and floor are solid.");
  return ok();
}

/**
 * The wooden door it can make from the wood it carries: the kind it has
 * enough of (a door takes 6 planks of one wood; a log makes 4). Null when no
 * one kind is enough (a few birch planks and oak logs make no birch door: it
 * went on chopping oak for a birch door, fresh-world test).
 */
function doorForMyWood(): string | null {
  const c = catalog();
  const planks = new Map<string, number>();
  for (const i of bot.inventory.items()) {
    const kind = c.isPlanks(i.name) ? i.name : c.isLog(i.name) ? c.planksFor(i.name) : null;
    if (!kind) continue;
    planks.set(kind, (planks.get(kind) ?? 0) + (c.isPlanks(i.name) ? i.count : i.count * 4));
  }
  return (
    [...planks.entries()]
      .filter(([, n]) => n >= 6)
      .sort((a, b) => b[1] - a[1])
      .map(([kind]) => kind.replace(/_planks$/, "_door"))
      .find((door) => bot.registry.itemsByName[door] !== undefined) ?? null
  );
}

/** Makes a wooden door and puts it in the entrance doorway (no door: the night seal is used instead). */
async function putInDoor(at: Vec3): Promise<void> {
  if (isWoodenDoor(knownBlock(at)?.name ?? "")) return;
  const carriedDoor = bot.inventory.items().find((i) => isWoodenDoor(i.name));
  // Not enough of any one wood: 2 logs of whatever grows nearby first
  if (!carriedDoor && !doorForMyWood()) {
    const { gatherWood } = await import("./gatherWood");
    await gatherWood(2);
  }
  const door = carriedDoor?.name ?? doorForMyWood() ?? "oak_door";
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

/** Walks into its shelter's room, the way a player goes home (by the top of its stairs). */
async function walkHome(room: { x: number; y: number; z: number; details?: Record<string, unknown> }): Promise<ActionResult> {
  // The way a player goes home: to the top of its stairs first (from far off
  // in legs), then down them and in. One path search straight into the
  // room "took too long to decide" from 15 blocks away (fresh-world test):
  // it weighed digging down through the ground everywhere
  const top = room.details?.["start"] as Pos | undefined;
  // Already under ground near home (the room, or down its mine): straight
  // there, not out to the surface and back in
  const here = bot.entity.position;
  const inside = Math.hypot(here.x - room.x, here.z - room.z) <= 32 && here.y < (top?.y ?? Infinity) - 1;
  if (top && !inside) {
    const atTop = (): boolean => bot.entity.position.distanceTo(new Vec3(top.x + 0.5, top.y, top.z + 0.5)) <= 1.5;
    if (bot.entity.position.distanceTo(new Vec3(top.x, top.y, top.z)) > 16) {
      const { travelToResult } = await import("./movement");
      const near = await travelToResult(() => ({ x: top.x, y: top.y, z: top.z }), { range: 2 });
      if (!near.ok) console.log(`On the way to my shelter: ${describeFailure(near)}.`);
    }
    if (!atTop()) {
      const stairs = await goTo(new pf.goals.GoalBlock(top.x, top.y, top.z));
      if (!stairs.ok) console.log(`Couldn't get to the top of my shelter's stairs: ${describeFailure(stairs)}; going straight in.`);
    }
  }
  return goTo(new pf.goals.GoalBlock(room.x, room.y, room.z));
}

/** Goes into the shelter (to the stand cell) and shuts the door, or closes the doorway with blocks. */
export async function enterShelter(): Promise<ActionResult> {
  const room = shelterPlace(false);
  if (!room) return fail("not_found", "no shelter");
  const walked = await walkHome(room);
  if (!walked.ok) return walked;
  // The mine's doorway: a door there too, when it carries one (a shelter
  // built before it had one; crafting makes doors in threes)
  const exitAt = cellsOf(room, "exit")[0];
  if (exitAt && knownBlock(exitAt)?.boundingBox === "empty" && bot.inventory.items().some((i) => isWoodenDoor(i.name))) {
    await putInDoor(new Vec3(exitAt.x, exitAt.y, exitAt.z));
  }
  // Both doors shut for the night (walking up to one out of reach first)
  for (const at of [exitAt, cellsOf(room, "door")[0]]) {
    const d = at ? knownBlock(at) : null;
    if (!at || !d || !isWoodenDoor(d.name) || d.getProperties()["open"] !== true) continue;
    if (!withinReach(at)) await goTo(new pf.goals.GoalNear(at.x, at.y, at.z, 2));
    const closed = await useBlock(knownBlock(at) ?? d);
    if (!closed.ok) console.log(`Couldn't close my shelter door at ${at.x}, ${at.y}, ${at.z}: ${describeFailure(closed)}`);
  }
  // Back to its spot in the room
  if (bot.entity.position.distanceTo(new Vec3(room.x + 0.5, room.y, room.z + 0.5)) > 1.5) await goTo(new pf.goals.GoalBlock(room.x, room.y, room.z));
  const doorAt = cellsOf(room, "door")[0];
  const door = doorAt ? knownBlock(doorAt) : null;
  if (door && isWoodenDoor(door.name)) return ok();
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

/** Its shelter's shell (walls, roof, floor) protected from walks and collecting; the doorway seal stays breakable. */
export function protectShelter(): void {
  const room = shelterPlace(false);
  const start = room?.details?.["start"] as Pos | undefined;
  const dir = room?.details?.["direction"] as DirectionType | undefined;
  if (!room || !start || !dir) return protectCells([]);
  const plan = shelterPlan(start, dir, (room.details?.["room"] as RoomSize | undefined) ?? DEFAULT_ROOM, (room.details?.["depth"] as number | undefined) ?? DEFAULT_DEPTH);
  const seal = new Set(cellsOf(room, "seal").map(cellKey));
  protectCells(plan.shell.filter((p) => !seal.has(cellKey(p))));
  setOwnPassages(plan.cells);
}

/** After a restart: blocks closing the doorway are its door again (the walking rules may break them). */
export function rememberShelterDoor(): void {
  protectShelter();
  const room = shelterPlace(false);
  if (!room) return;
  for (const p of cellsOf(room, "seal")) {
    const here = knownBlock(p);
    if (here && here.boundingBox === "block" && FILLERS.includes(here.name)) markDoor(p, here.name);
  }
}


const FACE_NAMES: Array<[Vec3, string]> = [[new Vec3(1, 0, 0), "east"], [new Vec3(-1, 0, 0), "west"], [new Vec3(0, 0, 1), "south"], [new Vec3(0, 0, -1), "north"]];
const faceName = (v: Vec3): string | null => FACE_NAMES.find(([d]) => d.equals(v))?.[1] ?? null;

/**
 * Where it stands to put something in the room's side spot `spot`: the
 * middle of that same row (owner's setupTheShelter). Placed from there, a
 * chest faces the middle, so two chests side by side along a wall face the
 * same way and join into a double chest. Pure.
 */
export function rowStand(spot: Pos, stand: Pos, dir: DirectionType): Vec3 {
  const along = ALONG[dir];
  const d = new Vec3(spot.x - stand.x, spot.y - stand.y, spot.z - stand.z);
  const steps = d.x * along.x + d.z * along.z;
  return new Vec3(stand.x, stand.y, stand.z).plus(along.scaled(steps));
}

/** The way a chest in `spot` faces when placed from its row's middle (toward the bot), e.g. "west". */
export function chestFacing(spot: Pos, stand: Pos, dir: DirectionType): string | null {
  const from = rowStand(spot, stand, dir);
  const v = new Vec3(Math.sign(from.x - spot.x), 0, Math.sign(from.z - spot.z));
  return faceName(v);
}

/** A chest in `spot` facing the way the layout needs (wrong-facing chests never join into double chests). */
export function rightChest(spot: Pos, stand: Pos, dir: DirectionType): boolean {
  const b = knownBlock(spot);
  return b?.name === "chest" && b.getProperties()["facing"] === chestFacing(spot, stand, dir);
}

/**
 * The chest in this spot will do: facing the right way, or facing wrong but
 * with things in it (taking it out would spill them; it stays).
 */
export function chestInPlace(spot: Pos, stand: Pos, dir: DirectionType): boolean {
  if (rightChest(spot, stand, dir)) return true;
  if (knownBlock(spot)?.name !== "chest") return false;
  const known = (getMemory().chests ?? []).find((c) => c.x === spot.x && c.y === spot.y && c.z === spot.z);
  // Never looked into (it placed it) or known empty: safe to turn round
  return !(known?.contents === null || known === undefined || (Array.isArray(known.contents) && known.contents.length === 0));
}

/** Stands in the middle of the spot's row and puts `item` there (it must carry one). */
async function placeFromRow(item: string, spot: Pos, stand: Pos, dir: DirectionType): Promise<ActionResult> {
  if (isCommandCancelled()) return fail("aborted", "stopped");
  const from = rowStand(spot, stand, dir);
  const there = await goTo(new pf.goals.GoalBlock(from.x, from.y, from.z));
  if (!there.ok) return there;
  // On the floor under the spot: it looks across the row, so a chest faces the middle
  const placed = await placeBlockResult(item, spot.x, spot.y, spot.z, "bottom");
  return placed.ok ? ok() : placed;
}

/** Gets `n` of `item` into the inventory (the planner: wood, a table, crafting). */
async function carry(item: string, n: number): Promise<ActionResult> {
  const have = bot.inventory.items().filter((i) => i.name === item).reduce((c, i) => c + i.count, 0);
  if (have >= n) return ok();
  const { acquire } = await import("../skills/acquire");
  const { liveWorld } = await import("../skills/world");
  return acquire(item, n, liveWorld);
}

/**
 * Furnishes the shelter exactly as the owner's original setupTheShelter did:
 * first everything it needs (6 chests for 3 double chests, a furnace, a
 * crafting table), then, in this order, standing in the middle of each row:
 * row 0 the chests either side, row 1 the chests either side (they join the
 * first two), row 2 the furnace and the crafting table, rows 3 and 4 the last
 * double chest. The shelter always gets its own table, even with another one
 * outside (owner: one outside and one inside is fine). A chest facing the
 * wrong way (from an older layout) is taken out and put back right.
 */
export async function setupTheShelter(): Promise<ActionResult> {
  const slots = shelterSlots();
  if (!slots || !slots.direction) {
    console.error("Basement location is undefined.");
    return fail("not_found", "no shelter to set up");
  }
  const { stand, direction: dir, chests } = slots;
  // The original order: (1,0) (-1,0) | (1,1) (-1,1) | furnace (1,2), table (-1,2) | (1,3) | (1,4)
  const steps: Array<{ item: string; spot: Pos | null | undefined }> = [
    { item: "chest", spot: chests[0] },
    { item: "chest", spot: chests[2] },
    { item: "chest", spot: chests[1] },
    { item: "chest", spot: chests[3] },
    { item: "furnace", spot: slots.furnace },
    { item: "crafting_table", spot: slots.table },
    { item: "chest", spot: chests[4] },
    { item: "chest", spot: chests[5] },
  ];
  const done = (step: { item: string; spot: Pos | null | undefined }): boolean =>
    !step.spot || (step.item === "chest" ? chestInPlace(step.spot, stand, dir) : knownBlock(step.spot)?.name === step.item);
  const todo = steps.filter((step) => !done(step));

  // Prepare resources first: each trip to a table is a trip out of the shelter
  for (const item of ["chest", "furnace", "crafting_table"]) {
    const n = todo.filter((t) => t.item === item && knownBlock(t.spot!)?.name !== item).length;
    if (n === 0) continue;
    const got = await carry(item, n);
    if (!got.ok) return got;
  }

  for (const { item, spot } of todo) {
    // A chest the wrong way round: out, and back in facing the middle
    if (item === "chest" && knownBlock(spot!)?.name === "chest") {
      const from = rowStand(spot!, stand, dir);
      const there = await goTo(new pf.goals.GoalBlock(from.x, from.y, from.z));
      if (!there.ok) return there;
      const out = await breakBlockAtResult(spot!.x, spot!.y, spot!.z);
      if (!out.ok) return out;
      await pickupNearbyItems(bot);
    }
    const placed = await placeFromRow(item, spot!, stand, dir);
    if (!placed.ok) return placed;
    if (item === "chest") await saveChestLocation(spot!);
    else if (item === "furnace") await saveFurnaceLocation(spot!);
    else await saveCraftingTableLocation(spot!);
  }
  await goTo(new pf.goals.GoalBlock(stand.x, stand.y, stand.z));
  return ok();
}

export async function buildShack() {}
export async function buildWoodenHouse() {}
export async function buildStoneHouse() {}

// TBD
export async function buildCastle() {}
export async function buildFortress() {}
export async function buildTower() {}
