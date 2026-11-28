import { bot } from "../core/body";
import { breakBlockAt, breakBlockAtResult } from "./blockBreaking";
import { placeBlock, placeBlockResult } from "./blockPlacing";
import { pickupNearbyItems } from "./pickup";
import { getMemory, saveMineLocation, updateMemory } from "../managers/persistenceManager";
import { Vec3 } from "vec3";
import { chatter } from "../core/narrator";
import { getItemCount } from "./inventory";
import pf from "mineflayer-pathfinder";
import { isNatural, isProtected, isWoodenDoor, protectedBy } from "../core/movements";
import { isOwnBlock } from "../core/scaffold";
import { catalog } from "../core/catalog";
import { isCommandCancelled } from "../core/commandContext";
import { goTo } from "../core/primitives";
import { pathing } from "../core/plugins";
import { describeFailure, expectOk } from "../core/result";

export type DirectionType = "north" | "south" | "west" | "east";

const OFFSETS: Record<DirectionType, { x: number; z: number }> = {
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
  south: { x: 0, z: 1 },
  north: { x: 0, z: -1 },
};
const SIDES = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

/** The direction (north/south/east/west) that heads most toward dx, dz. */
export function directionToward(dx: number, dz: number): DirectionType {
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? "east" : "west";
  return dz >= 0 ? "south" : "north";
}

/**
 * True for the walking space of a diagonal staircase through `start` (each
 * step `height` + 1 blocks tall, `width` wide), at any step along its line: a
 * mine dug one step at a time keeps its next steps clear too.
 */
export function inStaircase(p: Vec3, start: Vec3, direction: DirectionType, width: number, height: number, down = true): boolean {
  const o = OFFSETS[direction];
  const along = (p.x - start.x) * o.x + (p.z - start.z) * o.z;
  const lateral = o.x !== 0 ? p.z - start.z : p.x - start.x;
  if (lateral < 0 || lateral >= width) return false;
  const base = start.y + (down ? -along : along);
  return p.y >= base && p.y <= base + height;
}

/** Why the last tunnel stopped: something it must not dig, a drop it couldn't floor, nothing to build the floor with, or no tool that digs it. */
// "blocked": water, lava or something built (a real blocker); "dig_failed"
// and "unloaded": a dig that may work next time (review: one failed dig must
// never end a way down for good)
export type TunnelStop = "blocked" | "drop" | "no_filler" | "no_tool" | "dig_failed" | "unloaded" | "cave";

/**
 * Checks a straight tunnel runs at each column (the mine's caves rules):
 * `before` the column is dug, `after` it is; "stop" ends the tunnel there
 * (`tunnelStopReason()` says "cave", `tunnelColumns()` how far it got).
 */
export type ColumnHooks = {
  before?: (column: Vec3, i: number) => Promise<"go" | "stop">;
  after?: (column: Vec3, i: number) => Promise<"go" | "stop">;
};
let columnsDug = 0;

/** How many columns the last straight tunnel dug. */
export function tunnelColumns(): number {
  return columnsDug;
}

/**
 * Digs one block of a tunnel; false (stop the tunnel) when it has no tool
 * that can: it went on trying block after block, many a second, once its
 * pickaxe wore out deep in its mine (fresh-world test).
 */
async function digTunnelBlock(p: Vec3): Promise<boolean> {
  // A torch already lighting the tunnel (one it put up on an earlier trip): left up
  if (/torch$/.test(bot.blockAt(p)?.name ?? "")) return true;
  const dug = await breakBlockAtResult(p.x, p.y, p.z);
  if (dug.ok) return true;
  // No tool: the planner makes one; anything else it couldn't dig (out of
  // reach, refused, a keep-out area) is a blocker, never counted as dug
  lastStop = dug.reason === "no_tool" ? "no_tool" : dug.reason === "aborted" ? null : "dig_failed";
  console.log(`Tunnel stopped: ${describeFailure(dug)}.`);
  return false;
}
let lastStop: TunnelStop | null = null;

/** Why the last digDiagonalTunnel / digDiagonalTunnelUp returned false (null when it didn't). */
export function tunnelStopReason(): TunnelStop | null {
  return lastStop;
}

const FLOOR_FILLERS = ["dirt", "coarse_dirt", "cobblestone", "cobbled_deepslate", "netherrack"];

/**
 * The floor under a tunnel step made solid; false (stop digging) when it
 * can't be and there's a drop under it: stairs never go on into a cave or a
 * ravine with nothing to stand on. Over a cave the step also gets its side
 * walls (a tunnel, not an open bridge mobs walk up).
 */
/** Lava down a gap under `floor` (before solid ground, within 6). */
function lavaBelow(floor: Vec3): boolean {
  for (let d = 1; d <= 6; d++) {
    const b = bot.blockAt(floor.offset(0, -d, 0));
    if (b?.name === "lava") return true;
    if (!b || b.boundingBox === "block") return false; // solid ground first
  }
  return false;
}

// Steps whose floor went in before they were dug (a cave under them): their
// side walls go in too once they're dug (floorUnder)
const flooredFirst = new Set<string>();

/**
 * The floor under a step put in before the step is dug, when there's a cave
 * under it: against the underside of the step's bottom block, still
 * standing. "lava" when there's lava down there (no step over it).
 */
async function floorFirst(step: Vec3, keepClear: (p: Vec3) => boolean): Promise<"filled" | "lava" | "none"> {
  const floor = step.offset(0, -1, 0);
  if (keepClear(floor) || !isHoleBlock(bot.blockAt(floor))) return "none";
  if (lavaBelow(floor)) return "lava";
  // The step itself already open (the stairs run into a cave): its floor
  // built from the step above, with supports, before it ever steps in (game
  // test: every cell of the step was cave air, it stepped in, fell into the
  // cave, and the stairs were given up; owner: "it's fine to build stairs,
  // paths, walls")
  if (bot.blockAt(step)?.boundingBox !== "block") {
    if (!(await ensureBlock(floor, keepClear))) return "none";
    console.log(`Cave through the step at ${step}: its floor built first.`);
    flooredFirst.add(step.toString());
    return "filled";
  }
  const filler = FLOOR_FILLERS.find((n) => getItemCount(n) > 0);
  if (!filler) return "none";
  const placed = await placeBlockResult(filler, floor.x, floor.y, floor.z, "top");
  if (!placed.ok) return "none";
  console.log(`Cave under the step at ${step}: its floor put in first.`);
  flooredFirst.add(step.toString());
  return "filled";
}

async function floorUnder(step: Vec3, keepClear: (p: Vec3) => boolean, direction: DirectionType): Promise<boolean> {
  const floor = step.offset(0, -1, 0);
  const filledFirst = flooredFirst.delete(step.toString());
  const wasHole = filledFirst || isHoleBlock(bot.blockAt(floor));
  // Lava down in the gap: no bridge over it, the tunnel ends here (owner)
  const lavaDown = (): boolean => lavaBelow(floor);
  if (wasHole && lavaDown()) {
    lastStop = "blocked";
    console.log(`Tunnel stopped: lava under the gap at ${floor}; no bridge over it.`);
    return false;
  }
  if (await ensureBlock(floor, keepClear)) {
    if (wasHole && bot.blockAt(floor.offset(0, -1, 0))?.boundingBox === "empty") await wallIn(step, keepClear, direction);
    return true;
  }
  const below = bot.blockAt(floor.offset(0, -1, 0));
  if (below && below.boundingBox !== "empty") return true; // a one-block dip: still walkable
  lastStop = FLOOR_FILLERS.some((n) => getItemCount(n) > 0) ? "drop" : "no_filler";
  console.log(`Tunnel stopped: no floor at ${floor}, and a drop under it${lastStop === "no_filler" ? " (nothing to build it with)" : ""}.`);
  return false;
}

/** The side walls of a step (feet and head height) where they're open: a cave on either side. */
async function wallIn(step: Vec3, keepClear: (p: Vec3) => boolean, direction: DirectionType): Promise<void> {
  for (const side of WALLS[direction]) {
    for (const h of [0, 1]) {
      const wall = step.offset(0, h, 0).plus(SIDE_DIRS[side]!);
      if (!keepClear(wall) && isHoleBlock(bot.blockAt(wall))) await ensureBlock(wall, keepClear);
    }
  }
}

/**
 * Why a tunnel must stop before digging here, or null when it's fine: lava
 * or water in or next to the block (it would flood the tunnel; digging in
 * water is slow and the bot can drown), or a block someone built (an
 * underground base, a mineshaft's planks) that is never broken.
 */
export function tunnelBlocked(pos: Vec3): string | null {
  const block = bot.blockAt(pos);
  if (!block) return `unloaded ground at ${pos}`;
  if (block.name === "lava" || block.name === "water") return `${block.name} at ${pos}`;
  for (const side of SIDES) {
    const liquid = bot.blockAt(pos.plus(side))?.name;
    if (liquid === "lava" || liquid === "water") return `${liquid} next to ${pos}`;
  }
  const open = block.boundingBox === "empty";
  // Its shelter's walls and roof, its fields, its mine's stairs: never dug
  // through by a tunnel (game test: tunnelling to dirt from inside, it broke
  // its shelter's roof). Ore in its mine's walls is still mined.
  const keptBy = open ? null : protectedBy(pos);
  if (keptBy && !(keptBy === "mine" && catalog().isOre(block.name))) return `my ${keptBy}'s ${keptBy === "farm" ? "ground" : "wall"} at ${pos}`;
  // Something built stops a tunnel, unless the bot put it there itself (its
  // scaffolding stopped its own iron tunnel, fresh-world test)
  if (!open && !isNatural(block.name) && !isOwnBlock(pos, block.name) && !isPlug(pos)) return `${block.name.replace(/_/g, " ")} at ${pos}, something built`;
  return null;
}

/**
 * Water or lava in or next to the block a tunnel is about to dig: a player
 * plugs it with a block first (its main tunnel ended at a pool of water and
 * every iron trip stopped there, fresh-world test). Fills each liquid cell
 * (dirt first; cobblestone placed in the tunnel's own way is marked as its
 * own so the tunnel digs it). A few passes: flowing water refills. False
 * with nothing to plug it with or a cell it can't fill.
 */
// Blocks its tunnels put into water or lava: its own, dug through like stone
// (remembered per world, so a restart still knows them)
const plugKey = (p: { x: number; y: number; z: number }): string => `${p.x},${p.y},${p.z}`;
const isPlug = (p: { x: number; y: number; z: number }): boolean => (getMemory().plugs ?? []).some((q) => plugKey(q) === plugKey(p));
async function rememberPlug(p: Vec3): Promise<void> {
  if (isPlug(p)) return;
  await updateMemory({ plugs: [...(getMemory().plugs ?? []), { x: p.x, y: p.y, z: p.z }] });
}

async function plugLiquids(pos: Vec3): Promise<boolean> {
  const liquid = (p: Vec3): boolean => ["water", "lava"].includes(bot.blockAt(p)?.name ?? "");
  for (let pass = 0; pass < 3; pass++) {
    const cells = [pos, ...SIDES.map((s) => pos.plus(s))].filter(liquid);
    if (cells.length === 0) return true;
    const kind = bot.blockAt(cells[0]!)?.name ?? "water";
    for (const c of cells) {
      const filler = ["dirt", "coarse_dirt", "cobblestone", "cobbled_deepslate", "netherrack"].find((n) => getItemCount(n) > 0);
      if (!filler) return false;
      let placed = await placeBlockResult(filler, c.x, c.y, c.z, "side");
      // Out of reach: closer, and again (game test: the last of four water
      // cells was out of reach, the tunnel gave up there, and that water
      // flooded the bottom of its stairs, where it later drowned twice)
      if (!placed.ok && placed.reason === "out_of_reach" && (await goTo(new pf.goals.GoalNear(c.x, c.y, c.z, 2))).ok) {
        placed = await placeBlockResult(filler, c.x, c.y, c.z, "side");
      }
      if (!placed.ok) return false;
      // Remembered as its own plug: the tunnel digs through it (cobblestone
      // otherwise counts as "something built" and stops it)
      await rememberPlug(c);
    }
    console.log(`Plugged ${cells.length} block(s) of ${kind} next to my tunnel at ${pos}.`);
  }
  return ![pos, ...SIDES.map((s) => pos.plus(s))].some(liquid);
}

/**
 * True (the tunnel ends here) when the block it would dig next is water or
 * lava, or a plug it put into water there: a pool or a lake ahead, not a
 * drip in a wall. Its face is filled first. Owner: tunnels never go into
 * water (game test: a sleeve plugged its way 4 blocks into an underground
 * lake, the owner opened the end plug and the lake flooded the sleeve).
 * Water beside the block only (in a wall) is still plugged and dug past.
 */
async function intoWater(pos: Vec3): Promise<boolean> {
  const name = bot.blockAt(pos)?.name ?? "";
  const liquid = name === "water" || name === "lava";
  // (a plug spot dug out since is just air, and a plug with no water or lava
  // against it any more, or one that filled a cave's opening, isn't water)
  const liquidNext = (): boolean => SIDES.some((d) => /^(water|lava)$/.test(bot.blockAt(pos.plus(d))?.name ?? ""));
  if (!liquid && !(isPlug(pos) && bot.blockAt(pos)?.boundingBox === "block" && liquidNext())) return false;
  if (liquid) await plugLiquids(pos);
  lastStop = "blocked";
  const what = liquid ? name : "water";
  console.log(`Tunnel stopped: ${what} ahead at ${pos}; not digging into it.`);
  chatter(`I stopped digging: ${what} ahead at ${pos}.`, "tunnel");
  return true;
}

/** Checks one block before a tunnel digs it; logs and tells the owner when it must stop. */
function stopTunnelAt(pos: Vec3): boolean {
  if (isCommandCancelled()) return true;
  const why = tunnelBlocked(pos);
  if (!why) return false;
  lastStop = why.startsWith("unloaded") ? "unloaded" : "blocked";
  console.log(`Tunnel stopped: ${why}.`);
  bot.chat(`I stopped digging: ${why}.`);
  return true;
}

// --- Torches ----------------------------------------------------------------

/** A torch every this many blocks along a tunnel, like a player lighting the way back. */
export const TORCH_EVERY = 7;
const NO_TORCH_NOTICE_MS = 10 * 60_000;
let stepsSinceTorch = 0;
let lastNoTorchNotice = 0;

const SIDE_DIRS: Record<string, Vec3> = {
  north: new Vec3(0, 0, -1),
  south: new Vec3(0, 0, 1),
  east: new Vec3(1, 0, 0),
  west: new Vec3(-1, 0, 0),
};
// The walls beside a tunnel (never the block ahead, which the next step digs away)
const WALLS: Record<DirectionType, string[]> = {
  east: ["north", "south"],
  west: ["south", "north"],
  north: ["east", "west"],
  south: ["west", "east"],
};

/** Starts torch spacing afresh (a new tunnel route begins at the bot). */
export function resetTorchSpacing(): void {
  stepsSinceTorch = 0;
}

/**
 * A torch to place: one it carries, or crafted from the coal or charcoal and
 * sticks it carries (sticks from its planks or logs). It never goes off to
 * gather for this: coal turns up while mining anyway.
 */
/** Torches in hand, crafting a few from coal and sticks first if it has none; else why not. */
export async function torchReady(): Promise<true | string> {
  if (getItemCount("torch") > 0) return true;
  const fuel = getItemCount("coal") + getItemCount("charcoal");
  if (fuel === 0) return "I have no torches and no coal to make them";
  const { inventoryFull } = await import("./storage");
  if (inventoryFull()) {
    // Crafting needs a free slot: put the cheap stuff away first (or make a chest)
    const { makeRoom } = await import("./overflow");
    if (!(await makeRoom("make torches"))) return "My inventory is full, so I can't make torches";
  }
  const { craftRecipe } = await import("./crafting");
  if (getItemCount("stick") === 0) {
    if (getItemCount("planks") === 0) {
      const log = bot.inventory.items().find((i) => catalog().isLog(i.name));
      const planks = log ? catalog().planksFor(log.name) : null;
      if (planks) await craftRecipe(planks, 4);
    }
    if (getItemCount("planks") > 0) await craftRecipe("stick", 4);
  }
  const sticks = getItemCount("stick");
  if (sticks === 0) return "I have coal but no sticks, planks or logs for torches";
  const make = Math.min(fuel, sticks, 4) * 4; // 1 coal + 1 stick = 4 torches
  if (await craftRecipe("torch", make)) console.log(`Crafted ${getItemCount("torch")} torches for the tunnel.`);
  return getItemCount("torch") > 0 ? true : "I couldn't craft torches";
}

// Where a torch goes, in cells over where one stands: the 3rd block over the
// ground first, higher up in tall stairs; never on the ground or at head
// height, where it's in the way and walked into
export const TORCH_HEIGHTS = [2, 3, 4];

/** Where one stands in the open column at `spot`: down to the cell over solid ground (at most 4). */
function standOf(spot: Vec3): Vec3 {
  let s = spot;
  for (let k = 0; k < 4; k++) {
    const below = bot.blockAt(s.offset(0, -1, 0));
    if (!below || below.boundingBox === "block") break;
    s = s.offset(0, -1, 0);
  }
  return s;
}

/**
 * Puts a torch on a wall of the open column at `spot`, at a TORCH_HEIGHTS
 * cell over where one stands there, on one of `sides`. True when one went up.
 */
export async function placeWallTorch(spot: Vec3, sides: string[] = Object.keys(SIDE_DIRS)): Promise<boolean> {
  const stand = standOf(spot);
  // A tunnel only 2 high (a way dug to an ore) has no 3rd block: head height
  // there, on the wall (better than leaving it dark), never the ground
  const roof = bot.blockAt(stand.offset(0, TORCH_HEIGHTS[0]!, 0));
  const heights = roof && roof.boundingBox === "block" ? [1] : TORCH_HEIGHTS;
  for (const h of heights) {
    const cell = stand.offset(0, h, 0);
    const here = bot.blockAt(cell);
    if (!here || here.boundingBox === "block") break; // the roof: no higher
    if (here.name !== "air" && here.name !== "cave_air") continue;
    for (const side of sides) {
      const wall = bot.blockAt(cell.plus(SIDE_DIRS[side]!));
      if (wall?.boundingBox !== "block") continue;
      if (await placeBlock("torch", cell.x, cell.y, cell.z, side)) {
        console.log(`Placed a torch at ${cell} on the ${side} wall.`);
        return true;
      }
    }
  }
  return false;
}

/** Puts a torch on a wall beside `spot` (air inside the tunnel), up at TORCH_HEIGHTS. */
async function placeTunnelTorch(spot: Vec3, direction: DirectionType): Promise<boolean> {
  return placeWallTorch(spot, WALLS[direction]);
}

/**
 * A torch on a wall beside `spot` (an open cell of a tunnel or stairs going
 * `direction`), crafting torches first if it must. Says why not otherwise.
 */
export async function lightSpot(spot: Vec3, direction: DirectionType): Promise<true | string> {
  const ready = await torchReady();
  if (ready !== true) return ready;
  return (await placeTunnelTorch(spot, direction)) ? true : `no wall to put a torch on at ${spot}`;
}

/**
 * Called once per tunnel step: every `every` steps, lights the tunnel with a
 * torch (crafting some first if needed). Without torches or coal it says so
 * now and then, and keeps digging.
 */
async function torchStep(spot: Vec3, direction: DirectionType, every = TORCH_EVERY): Promise<void> {
  stepsSinceTorch++;
  if (stepsSinceTorch < every) return;
  const ready = await torchReady();
  if (ready !== true) {
    stepsSinceTorch = 0; // try again a torch-spacing further on, not every step
    if (Date.now() - lastNoTorchNotice > NO_TORCH_NOTICE_MS) {
      lastNoTorchNotice = Date.now();
      bot.chat(`${ready}, so this tunnel stays dark for now.`);
    }
    return;
  }
  if (await placeTunnelTorch(spot, direction)) stepsSinceTorch = 0;
}


/**
 * Digs a diagonal tunnel in the specified direction.
 * @param direction The direction to dig the tunnel in.
 * @param depth The depth of the tunnel.
 * @param tunnelSize The size of the tunnel.
 * @param torchInterval The interval at which to place torches.
 * @returns A promise that resolves to a boolean indicating whether the tunnel was successfully dug.
 */
export async function digDiagonalTunnel(
  direction: DirectionType = "south",
  depth: number = 10,
  tunnelSize: { width: number; height: number } = { width: 1, height: 4 },
  startPosition?: Vec3,
  tunnelName: string = `Tunnel-${direction}-${depth}`,
  torchInterval: number = TORCH_EVERY,
  options: { save?: boolean } = {}
): Promise<boolean> {
  // A shelter's stairs and the mine's single steps aren't mines of their own
  const remember = tunnelName !== "basementEntrance" && options.save !== false;
  lastStop = null;
  if (!startPosition) startPosition = bot.entity.position.clone();

  const offsetX = direction === "east" ? 1 : direction === "west" ? -1 : 0;
  const offsetZ = direction === "south" ? 1 : direction === "north" ? -1 : 0;
  const start = startPosition;
  const keepClear = (p: Vec3): boolean => inStaircase(p, start, direction, tunnelSize.width, tunnelSize.height);

  for (let w = 0; w < tunnelSize.width; w++) {
    const wOffsetX = direction === "north" || direction === "south" ? w : 0;
    const wOffsetZ = direction === "east" || direction === "west" ? w : 0;

    for (let i = 0; i <= depth; i++) {
      const basePosition = startPosition.offset(
        wOffsetX + i * offsetX,
        -i,
        wOffsetZ + i * offsetZ
      );

      for (let h = tunnelSize.height; h >= 0; h--) {
        const digPosition = basePosition.offset(0, h, 0);
        // Its own door in the way (the mine starts in the shelter's back
        // doorway): a passage, walked through, never dug out
        if (isWoodenDoor(bot.blockAt(digPosition)?.name ?? "")) continue;
        // Its shelter's walls, roof and floor: never dug (the mine's first
        // stair, in the back doorway, dug the block over the door)
        if (isProtected(digPosition)) continue;
        if (await intoWater(digPosition)) return false;
        await plugLiquids(digPosition);
        if (stopTunnelAt(digPosition)) return false;
        // A cave under the step: its floor first, while the block over it
        // still stands, so the step never opens onto the drop (game test:
        // the stairs opened into a cavern, a zombie came up, the fight
        // followed it and the bot fell in before the floor was put back)
        if (h === 0 && (await floorFirst(basePosition, keepClear)) === "lava") {
          lastStop = "blocked";
          console.log(`Tunnel stopped: lava under the cave at ${basePosition.offset(0, -1, 0)}; no step over it.`);
          return false;
        }
        if (!(await digTunnelBlock(digPosition))) return false;
        // Straight on to the next block: each dig already waits for the server

        // After digging the floor block, ensure there is a foundation
        // (bridged over a cave; the tunnel stops at a drop it can't floor)
        if (h === 0 && !(await floorUnder(basePosition, keepClear, direction))) return false;
      }

      await pickupNearbyItems(bot);

      if (w === tunnelSize.width - 1) await torchStep(basePosition.offset(0, 2, 0), direction, torchInterval);
    }
  }

  // Commentary (the shelter announces itself)
  if (remember) chatter(`I've dug ${tunnelName.replace(/-/g, " ")}.`, "digging");

  if (remember)
    saveMineLocation({
      name: tunnelName,
      direction,
      startsAt: startPosition,
      endsAt: startPosition.offset(depth * offsetX, -depth, depth * offsetZ),
      depth,
    });

  /* const cobblestoneCount = bot.inventory
    .items()
    .filter((item) => item.name === "cobblestone")
    .reduce((acc, item) => acc + item.count, 0);
  const stairsNeeded = Math.floor(depth * tunnelSize.width);
  const cobblestonesNeeded = Math.ceil(stairsNeeded / 0.66);

  if (cobblestoneCount >= cobblestonesNeeded) {
    await craftRecipe("cobblestone_stairs", stairsNeeded);
    bot.chat(`Crafted ${stairsNeeded} cobblestone stairs.`);
  } else {
    bot.chat(
      `Not enough cobblestone! I have ${cobblestoneCount} and I need ${cobblestonesNeeded} blocks.`
    );
  }

  for (let i = 1; i <= depth; i++) {
    for (let w = 0; w < tunnelSize.width; w++) {
      const wOffsetX = direction === "north" || direction === "south" ? w : 0;
      const wOffsetZ = direction === "east" || direction === "west" ? w : 0;

      const stairPosition = startPosition.offset(
        wOffsetX + i * offsetX,
        -i,
        wOffsetZ + i * offsetZ
      );
      const stairs = bot.inventory
        .items()
        .find((item) => item.name === "cobblestone_stairs");
      if (stairs) {
        await placeBlock(
          "cobblestone_stairs",
          stairPosition.x,
          stairPosition.y,
          stairPosition.z,
          "bottom"
        );
        bot.chat(`Placed cobblestone stair at ${stairPosition.toString()}`);
      }
    }
  } */

  return true;
}

/**
 * Builds a doorway at the specified position.
 * @param position The position to build the doorway at.
 * @param direction The direction the doorway should face.
 */
export async function digDoorway(position: Vec3, direction: string) {
  const offsetX = direction === "east" ? 1 : direction === "west" ? -1 : 0;
  const offsetZ = direction === "south" ? 1 : direction === "north" ? -1 : 0;

  // Clear the doorway space (2 blocks high)
  for (let y = 0; y < 2; y++) {
    const doorwayBlock = position.offset(offsetX, y, offsetZ);
    await breakBlockAt(doorwayBlock.x, doorwayBlock.y, doorwayBlock.z);

    // Ensure foundation under the floor blocks (never a support block in the doorway itself)
    const doorway = (p: Vec3): boolean => p.x === doorwayBlock.x && p.z === doorwayBlock.z && p.y >= position.y && p.y <= position.y + 1;
    if (y === 0) {
      await ensureBlock(doorwayBlock.offset(0, -1, 0), doorway);
    } else if (y === 1) {
      // Ensure ceiling block
      await ensureBlock(doorwayBlock.offset(0, 1, 0), doorway);
    }
  }

  // !important: Bot can't go thought doors yet
  // Place the door
  // await ensureDoor(); // Ensure the bot has a door
  // await placeBlock("wooden_door", position.x, position.y, position.z);
}

/**
 * Digs a straight tunnel in the specified direction.
 * @param direction The direction to dig the tunnel in.
 * @param length The length of the tunnel.
 * @param startPosition The starting position of the tunnel.
 */
export async function digStraightTunnel(
  direction: "north" | "south" | "east" | "west",
  length: number,
  startPosition: Vec3,
  width = 3,
  height = 2,
  hooks: ColumnHooks = {}
): Promise<boolean> {
  columnsDug = 0;
  const offsetX = direction === "east" ? 1 : direction === "west" ? -1 : 0;
  const offsetZ = direction === "south" ? 1 : direction === "north" ? -1 : 0;
  // Sideways is across the tunnel: along Z for an east/west tunnel, along X for north/south
  const side = new Vec3(Math.abs(offsetZ), 0, Math.abs(offsetX));
  const half = Math.floor(width / 2);
  lastStop = null;
  // The tunnel's own space: support blocks never go there
  const keepClear = (p: Vec3): boolean => {
    const along = (p.x - startPosition.x) * offsetX + (p.z - startPosition.z) * offsetZ;
    const across = (p.x - startPosition.x) * side.x + (p.z - startPosition.z) * side.z;
    return along >= 1 && along <= length && across >= -half && across <= width - 1 - half && p.y >= startPosition.y && p.y <= startPosition.y + height - 1;
  };

  for (let i = 1; i <= length; i++) {
    const position = startPosition.offset(offsetX * i, 0, offsetZ * i);
    // From inside its own tunnel, like a miner: into the last block it dug
    // (the start for the first), then the next column from there. Owner:
    // pokeholes became chaos; a walk to "anywhere within 2" of the next block
    // dug its own way to a spot in the wall or the ceiling between them.
    // Digging costs so much on this walk that the open tunnel always wins.
    const stand = startPosition.offset(offsetX * (i - 1), 0, offsetZ * (i - 1));
    if (!bot.entity.position.floored().equals(stand)) {
      await pathing.withRules({ digCost: 100 }, () => goTo(new pf.goals.GoalBlock(stand.x, stand.y, stand.z)));
    }
    if (hooks.before && (await hooks.before(position, i)) === "stop") {
      lastStop = "cave";
      return false;
    }
    // Dig out a tunnel `height` high (2: a walkway; 3: a pokehole), `width` wide
    for (let y = 0; y < height; y++) {
      for (let x = -half; x <= width - 1 - half; x++) {
        const blockPos = position.offset(side.x * x, y, side.z * x);
        if (await intoWater(blockPos)) return false;
        await plugLiquids(blockPos);
        if (stopTunnelAt(blockPos)) return false;
        if (!(await digTunnelBlock(blockPos))) return false;

        // Ensure foundation under the floor blocks (bridged over a cave; a
        // drop it can't floor stops the tunnel, never counted as dug)
        if (y === 0 && !(await floorUnder(blockPos, keepClear, direction))) return false;
      }
    }
    await pickupNearbyItems(bot, 4);
    // On the outer column's wall, at the top of the 2-high tunnel
    const outer = width - 1 - half;
    await torchStep(position.offset(side.x * outer, 1, side.z * outer), direction);
    columnsDug = i;
    if (hooks.after && (await hooks.after(position, i)) === "stop") {
      lastStop = "cave";
      return false;
    }
  }
  return true;
}

/**
 * Digs a room at the specified position.
 * Ensures that all surrounding walls, floor, and ceiling are solid by placing a foundation block if necessary.
 * @param roomStart The starting position of the room.
 * @param roomSize The size of the room.
 */
export async function digRoom(
  roomStart: Vec3,
  roomSize: { width: number; height: number; length: number },
  direction: DirectionType = "south"
) {
  // Along the room and across it (south: along +z, across +x, as it always was)
  const along = OFFSETS[direction];
  const across = new Vec3(Math.abs(along.z), 0, Math.abs(along.x));
  const at = (x: number, y: number, z: number): Vec3 =>
    roomStart.offset(across.x * x + along.x * z, y, across.z * x + along.z * z);
  // The room and its two doorways (the middle column, at each end): walls,
  // floor and roof get built, never a support block in there
  const inRoom = (p: Vec3): boolean => {
    const d = p.minus(roomStart);
    const x = d.x * across.x + d.z * across.z;
    const z = d.x * along.x + d.z * along.z;
    if (d.y < 0 || d.y >= roomSize.height) return false;
    if (x === 0 && d.y <= 1 && (z === -1 || z === roomSize.length)) return true;
    return x >= -1 && x <= roomSize.width - 2 && z >= 0 && z < roomSize.length;
  };
  const ensure = (p: Vec3): Promise<boolean> => (inRoom(p) ? Promise.resolve(true) : ensureBlock(p, inRoom));
  for (let z = 0; z < roomSize.length; z++) {
    for (let y = 0; y < roomSize.height; y++) {
      for (let x = -1; x < roomSize.width - 1; x++) {
        const roomBlock = at(x, y, z);
        await breakBlockAt(roomBlock.x, roomBlock.y, roomBlock.z);

        // Ensure the floor foundation
        if (y === 0) {
          await ensure(roomBlock.offset(0, -1, 0));
        }

        // Ensure walls
        if (x === -1) {
          await ensure(at(x - 1, y, z));
        } else if (x === roomSize.width - 2) {
          await ensure(at(x + 1, y, z));
        }

        // Ensure sides walls. Currently he blocks doorways
        /* if (z === 0) {
          await ensure(roomBlock.offset(0, 0, -1));
        } else */
        if (z === roomSize.length - 1) {
          await ensure(at(x, y, z + 1));
        }

        // Ensure ceiling block
        if (y === roomSize.height - 1) {
          await ensure(roomBlock.offset(0, 1, 0));
        }
      }
    }
  }
}

/** Leaves rot away and sand falls: never a floor, wall or roof to rely on. */
const isWeak = (name: string): boolean => name.endsWith("_leaves");
// What holes are filled with: dirt first, then stone; never planks (stone and
// wood are for tools; the shelter burned its cobblestone on floors and
// couldn't make stone tools)
const FILLERS = ["dirt", "coarse_dirt", "cobblestone", "cobbled_deepslate", "netherrack"];
// Sealing a way in from outside: stone first (owner: blocked with cobblestone)
export const STONE_FILLERS = ["cobblestone", "cobbled_deepslate", "stone", "andesite", "diorite", "granite", "tuff", "dirt", "coarse_dirt"];

export const isHoleBlock = (b: { name: string; boundingBox: string } | null): boolean =>
  b !== null && (b.boundingBox === "empty" || b.name === "water" || b.name === "lava" || isWeak(b.name));
const isSolidBlock = (b: { name: string; boundingBox: string } | null): boolean =>
  b !== null && b.boundingBox === "block" && !isWeak(b.name);

/**
 * The cell to put a support block in when `position` has nothing solid next
 * to it (stairs going down over a cave or ravine): a neighbour of it that is
 * open, isn't walking space (`keepClear`), and has something solid to place
 * against. Like a player bridging: one block out from the last solid one,
 * then the floor against it. Pure, tested with a made-up world.
 */
export function supportFor(position: Vec3, blockAt: (p: Vec3) => { name: string; boundingBox: string } | null, keepClear: (p: Vec3) => boolean = () => false): Vec3 | null {
  const chain = supportChain(position, blockAt, keepClear, 1);
  return chain && chain.length === 1 ? chain[0]! : null;
}

/**
 * The support blocks a hole needs before it can be filled, in the order to
 * place them: none when something solid is next to it already; otherwise the
 * shortest run (up to `maxBlocks`) of open cells from one beside something
 * solid to one beside the hole, never through `keepClear` cells. Its stairs
 * stopped over water two blocks from the nearest stone ("nothing to put it
 * against"), and the mine ended there. Null when there is none. Pure.
 */
export function supportChain(position: Vec3, blockAt: (p: Vec3) => { name: string; boundingBox: string } | null, keepClear: (p: Vec3) => boolean = () => false, maxBlocks = 3): Vec3[] | null {
  const solidNext = (c: Vec3): boolean => SIDES.some((s) => isSolidBlock(blockAt(c.plus(s))));
  if (solidNext(position)) return [];
  const key = (c: Vec3): string => `${c.x},${c.y},${c.z}`;
  // Breadth first out from the hole: the first open cell beside something solid ends it
  let frontier: Vec3[][] = [[position]];
  const seen = new Set([key(position)]);
  for (let depth = 0; depth < maxBlocks; depth++) {
    const next: Vec3[][] = [];
    for (const path of frontier) {
      for (const s of SIDES) {
        const n = path[path.length - 1]!.plus(s);
        if (seen.has(key(n))) continue;
        seen.add(key(n));
        if (keepClear(n) || !isHoleBlock(blockAt(n))) continue;
        const longer = [...path, n];
        // Placed from the solid end back toward the hole
        if (solidNext(n)) return longer.slice(1).reverse();
        next.push(longer);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Makes the block at `position` solid: a hole (air, water, lava) or leaves
 * (they rot away) get dirt or stone. With nothing solid next to it to place
 * against (a cave under the stairs), a support block goes in first, never in
 * `keepClear` cells (the tunnel or room it is digging). True when the block
 * is solid afterwards.
 * @param position The block that must be solid (a floor, wall or roof cell).
 * @param keepClear Cells that must stay open (walking space): no support there.
 */
export async function ensureBlock(position: Vec3, keepClear: (p: Vec3) => boolean = () => false, fillers: string[] = FILLERS): Promise<boolean> {
  const here = bot.blockAt(position);
  if (!here) return false;
  if (!isHoleBlock(here)) return true;
  const filler = (): string | null => fillers.find((name) => getItemCount(name) > 0) ?? null;
  if (!filler()) {
    console.log(`I have nothing to fill the hole at ${position} with; leaving it.`);
    return false;
  }
  if (isWeak(here.name)) {
    const cleared = await breakBlockAtResult(position.x, position.y, position.z);
    if (!cleared.ok) return false;
  }
  // Never a support where it stands (game test: "I'm standing there", and the stairs stopped)
  const feet = bot.entity.position.floored();
  const clear = (p: Vec3): boolean => keepClear(p) || (p.x === feet.x && p.z === feet.z && (p.y === feet.y || p.y === feet.y + 1));
  const supports = supportChain(position, (p) => bot.blockAt(p), clear) ?? [];
  for (const support of supports) {
    if (!filler()) return false;
    const propped = await placeBlockResult(filler()!, support.x, support.y, support.z, "side");
    if (!propped.ok) {
      console.log(`Couldn't put a support block at ${support} for the hole at ${position}.`);
      return false;
    }
    await rememberPlug(support);
  }
  const support = supports.length > 0 ? supports[0] : null;
  const name = filler();
  if (!name) return false;
  const placed = await placeBlockResult(name, position.x, position.y, position.z, "side");
  if (!placed.ok) {
    console.log(`The hole at ${position} stays open: ${describeFailure(placed)}.`);
    return false;
  }
  // Its own block: a later tunnel digs through it ("something built" otherwise)
  await rememberPlug(position);
  console.log(`Filled the hole at ${position} with ${name}${support ? ` (${supports.length} support block${supports.length > 1 ? "s" : ""} from ${support} first)` : ""}.`);
  return true;
}

/**
 * The reverse of digDiagonalTunnel: digs a diagonal tunnel going up, one
 * block forward and one block up per step, the floor of each step kept solid.
 * @param direction The direction to dig the tunnel in.
 * @param rise How many blocks to go up.
 * @param tunnelSize Width, and how many blocks above the floor to clear.
 * @param startPosition Where the tunnel starts (the bot's feet by default).
 * @returns Whether the whole tunnel was dug (false when stopped or blocked).
 */
export async function digDiagonalTunnelUp(
  direction: DirectionType = "south",
  rise: number = 10,
  tunnelSize: { width: number; height: number } = { width: 1, height: 3 },
  startPosition?: Vec3,
  firstStep = 0
): Promise<boolean> {
  if (!startPosition) startPosition = bot.entity.position.floored();
  lastStop = null;
  const { x: offsetX, z: offsetZ } = OFFSETS[direction];

  for (let w = 0; w < tunnelSize.width; w++) {
    const wOffsetX = direction === "north" || direction === "south" ? w : 0;
    const wOffsetZ = direction === "east" || direction === "west" ? w : 0;

    for (let i = firstStep; i <= rise; i++) {
      const basePosition = startPosition.offset(wOffsetX + i * offsetX, i, wOffsetZ + i * offsetZ);

      for (let h = tunnelSize.height; h >= 0; h--) {
        const digPosition = basePosition.offset(0, h, 0);
        if (await intoWater(digPosition)) return false;
        await plugLiquids(digPosition);
        if (stopTunnelAt(digPosition)) return false;
        if (!(await digTunnelBlock(digPosition))) return false;

        // The block under each step is the stair itself: keep it solid
        if (h === 0 && !(await floorUnder(basePosition, (p) => inStaircase(p, startPosition!, direction, tunnelSize.width, tunnelSize.height, false), direction))) return false;
      }

      await pickupNearbyItems(bot);
      if (w === tunnelSize.width - 1) await torchStep(basePosition.offset(0, 2, 0), direction);
    }
  }
  return true;
}

/** Walks to a spot inside a tunnel it just dug (the path is clear, nothing to dig). */
async function walkTo(pos: Vec3): Promise<void> {
  expectOk(await goTo(new pf.goals.GoalBlock(pos.x, pos.y, pos.z)));
}

/**
 * Tunnels to a buried block the way a miner does: a diagonal tunnel down
 * (digDiagonalTunnel) or up (digDiagonalTunnelUp) to its level, then
 * straight tunnels (digStraightTunnel) along that level until next to it.
 * @returns Whether it got next to the target.
 */
export async function tunnelTo(target: Vec3, label: string): Promise<boolean> {
  resetTorchSpacing();
  const start = bot.entity.position.floored();
  const dy = target.y - start.y;
  let here = start.clone();

  if (Math.abs(dy) >= 2) {
    const direction = directionToward(target.x - start.x, target.z - start.z);
    const { x, z } = OFFSETS[direction];
    const steps = Math.abs(dy);
    console.log(`Tunnelling ${dy < 0 ? "down" : "up"} ${steps} blocks toward the ${label} (${direction}).`);
    const ok =
      dy < 0
        ? await digDiagonalTunnel(direction, steps, { width: 1, height: 3 }, start, `a tunnel down to the ${label}`)
        : await digDiagonalTunnelUp(direction, steps, { width: 1, height: 3 }, start);
    if (!ok) return false;
    here = start.offset(x * steps, dy, z * steps);
    await walkTo(here);
  }

  // Along the target's level: first east/west, then north/south, ending next to it
  const dx = target.x - here.x;
  const dz = target.z - here.z;
  const xLength = Math.abs(dz) > 0 ? Math.abs(dx) : Math.max(0, Math.abs(dx) - 1);
  if (xLength > 0) {
    if (!(await digStraightTunnel(dx > 0 ? "east" : "west", xLength, here, 1))) return false;
    here = here.offset(Math.sign(dx) * xLength, 0, 0);
    await walkTo(here);
  }
  const zLength = Math.max(0, Math.abs(dz) - 1);
  if (zLength > 0) {
    if (!(await digStraightTunnel(dz > 0 ? "south" : "north", zLength, here, 1))) return false;
    here = here.offset(0, 0, Math.sign(dz) * zLength);
    await walkTo(here);
  }
  return true;
}

/** True when nothing but open air (or plants) is above this spot: the sky. */
export function seesSky(pos: Vec3): boolean {
  const top = (bot.game as { minY?: number; height?: number }).minY ?? -64;
  const ceiling = top + ((bot.game as { height?: number }).height ?? 384);
  for (let y = pos.y + 2; y < ceiling; y++) {
    const block = bot.blockAt(new Vec3(pos.x, y, pos.z));
    if (!block) return true; // above the loaded world
    if (block.boundingBox !== "empty" && !block.name.endsWith("_leaves")) return false; // leaves: under a tree, outside
  }
  return true;
}

/**
 * Out on the surface: open sky above, and ground at its feet level ahead it
 * can walk onto (not still at the bottom of the tunnel's own opening).
 */
export function isOutside(feet: Vec3, direction: DirectionType): boolean {
  if (!seesSky(feet)) return false;
  const { x, z } = OFFSETS[direction];
  const empty = (dy: number): boolean => bot.blockAt(feet.offset(x, dy, z))?.boundingBox === "empty";
  return empty(0) || (empty(1) && empty(2)); // flat ground ahead, or one step up onto it
}

/**
 * Digs out to the surface with the reverse diagonal tunnel
 * (digDiagonalTunnelUp), one step at a time, until it can walk out under the
 * open sky. Starts the way the bot faces; if lava or something built is in
 * the way, tries the other directions.
 */
export async function digOutToSurface(maxRise = 120): Promise<boolean> {
  resetTorchSpacing();
  const yaw = bot.entity.yaw;
  // mineflayer yaw: 0 faces north (-z), PI/2 faces west (-x)
  const facing = directionToward(-Math.sin(yaw), -Math.cos(yaw));
  const order: DirectionType[] = [facing, ...(["north", "east", "south", "west"] as DirectionType[]).filter((d) => d !== facing)];

  let risen = 0;
  for (const direction of order) {
    const { x, z } = OFFSETS[direction];
    let first = true; // the first step also clears headroom over where it stands
    while (risen < maxRise) {
      if (isCommandCancelled()) return false;
      const here = bot.entity.position.floored();
      if (isOutside(here, direction)) {
        console.log(`Out on the surface at ${here}.`);
        return true;
      }
      if (!(await digDiagonalTunnelUp(direction, 1, { width: 1, height: 3 }, here, first ? 0 : 1))) break; // blocked: next direction
      first = false;
      await walkTo(here.offset(x, 1, z));
      risen++;
    }
    if (risen >= maxRise) break;
  }
  return seesSky(bot.entity.position.floored());
}
