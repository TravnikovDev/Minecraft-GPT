import { bot } from "../core/body";
import {
  breakBlockAt,
  pickupNearbyItems,
  placeBlock,
} from "../actions/worldInteraction";
import { __actionsDelay } from "../utils/utility";
import { saveMineLocation } from "../managers/persistenceManager";
import { Vec3 } from "vec3";
import { getItemCount } from "./inventory";
import { ensurePlanks } from "./ensure";
import pf from "mineflayer-pathfinder";
import { isNatural } from "../core/movements";
import { catalog } from "../core/catalog";
import { isCommandCancelled } from "../core/commandContext";
import { pathing } from "../core/plugins";

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
  if (!open && !isNatural(block.name)) return `${block.name.replace(/_/g, " ")} at ${pos}, something built`;
  return null;
}

/** Checks one block before a tunnel digs it; logs and tells the owner when it must stop. */
function stopTunnelAt(pos: Vec3): boolean {
  if (isCommandCancelled()) return true;
  const why = tunnelBlocked(pos);
  if (!why) return false;
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
async function torchReady(): Promise<true | string> {
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

/** Puts a torch on a wall beside `spot` (air inside the tunnel). */
async function placeTunnelTorch(spot: Vec3, direction: DirectionType): Promise<boolean> {
  for (const side of WALLS[direction]) {
    const wall = bot.blockAt(spot.plus(SIDE_DIRS[side]));
    if (wall?.boundingBox !== "block") continue;
    if (await placeBlock("torch", spot.x, spot.y, spot.z, side)) {
      console.log(`Placed a torch at ${spot} on the ${side} wall.`);
      return true;
    }
  }
  return false;
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
  torchInterval: number = TORCH_EVERY
): Promise<boolean> {
  if (!startPosition) startPosition = bot.entity.position.clone();

  const offsetX = direction === "east" ? 1 : direction === "west" ? -1 : 0;
  const offsetZ = direction === "south" ? 1 : direction === "north" ? -1 : 0;

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
        if (stopTunnelAt(digPosition)) return false;
        const digResult = await breakBlockAt(
          digPosition.x,
          digPosition.y,
          digPosition.z
        );
        await __actionsDelay(digResult ? 1000 : 200);

        // After digging the floor block, ensure there is a foundation
        if (h === 0) {
          await ensureBlock(basePosition.offset(0, -1, 0));
        }
      }

      await pickupNearbyItems(bot);

      if (w === tunnelSize.width - 1) await torchStep(basePosition.offset(0, 2, 0), direction, torchInterval);
    }
  }

  bot.chat(`I've dug ${tunnelName}`);

  if (tunnelName !== "basementEntrance")
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

    // Ensure foundation under the floor blocks
    if (y === 0) {
      await ensureBlock(doorwayBlock.offset(0, -1, 0));
    } else if (y === 1) {
      // Ensure ceiling block
      await ensureBlock(doorwayBlock.offset(0, 1, 0));
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
  width = 3
): Promise<boolean> {
  const offsetX = direction === "east" ? 1 : direction === "west" ? -1 : 0;
  const offsetZ = direction === "south" ? 1 : direction === "north" ? -1 : 0;
  // Sideways is across the tunnel: along Z for an east/west tunnel, along X for north/south
  const side = new Vec3(Math.abs(offsetZ), 0, Math.abs(offsetX));
  const half = Math.floor(width / 2);

  for (let i = 1; i <= length; i++) {
    const position = startPosition.offset(offsetX * i, 0, offsetZ * i);
    // Dig out a 2-high tunnel, `width` wide
    for (let y = 0; y < 2; y++) {
      for (let x = -half; x <= width - 1 - half; x++) {
        const blockPos = position.offset(side.x * x, y, side.z * x);
        if (stopTunnelAt(blockPos)) return false;
        await breakBlockAt(blockPos.x, blockPos.y, blockPos.z);

        // Ensure foundation under the floor blocks
        if (y === 0) {
          await ensureBlock(blockPos.offset(0, -1, 0));
        }
      }
    }
    await pickupNearbyItems(bot, 4);
    // On the outer column's wall, at the top of the 2-high tunnel
    const outer = width - 1 - half;
    await torchStep(position.offset(side.x * outer, 1, side.z * outer), direction);
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
  roomSize: { width: number; height: number; length: number }
) {
  for (let z = 0; z < roomSize.length; z++) {
    for (let y = 0; y < roomSize.height; y++) {
      for (let x = -1; x < roomSize.width - 1; x++) {
        const roomBlock = roomStart.offset(x, y, z);
        await breakBlockAt(roomBlock.x, roomBlock.y, roomBlock.z);
        await __actionsDelay(1000);

        // Ensure the floor foundation
        if (y === 0) {
          await ensureBlock(roomBlock.offset(0, -1, 0));
        }

        // Ensure walls
        if (x === -1) {
          await ensureBlock(roomBlock.offset(-1, 0, 0));
        } else if (x === roomSize.width - 2) {
          await ensureBlock(roomBlock.offset(1, 0, 0));
        }

        // Ensure sides walls. Currently he blocks doorways
        /* if (z === 0) {
          await ensureBlock(roomBlock.offset(0, 0, -1));
        } else */
        if (z === roomSize.length - 1) {
          await ensureBlock(roomBlock.offset(0, 0, 1));
        }

        // Ensure ceiling block
        if (y === roomSize.height - 1) {
          await ensureBlock(roomBlock.offset(0, 1, 0));
        }
      }
    }
  }
}

/**
 * Ensures that a block at a specific position is solid.
 * If it's air or water, a foundation block (dirt or planks) will be placed.
 * @param position The position of the block.
 */
export async function ensureBlock(position: Vec3): Promise<void> {
  // Only a hole needs filling; a solid floor needs nothing (it used to craft
  // planks for every floor block when the bot carried no dirt or planks)
  const blockToCheck = bot.blockAt(position);
  const isHole = blockToCheck?.boundingBox === "empty" || blockToCheck?.name === "water" || blockToCheck?.name === "lava";
  if (!isHole) return;

  // What a miner carries: the stone it dug out, then dirt, then planks
  const filler = ["cobblestone", "cobbled_deepslate", "dirt", "netherrack", "planks"].find((name) => getItemCount(name) > 0);
  if (!filler) {
    console.log("I have nothing to fill a hole in the floor with; making planks.");
    await ensurePlanks(4);
    if (getItemCount("planks") === 0) return;
  }
  const stubName = filler ?? "planks";
  const placeName = stubName === "planks" ? (bot.inventory.items().find((i) => i.name.endsWith("_planks"))?.name ?? "oak_planks") : stubName;
  await placeBlock(placeName, position.x, position.y, position.z);
  console.log(`Placed ${placeName} at ${position} to fix a hole.`);
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
  const { x: offsetX, z: offsetZ } = OFFSETS[direction];

  for (let w = 0; w < tunnelSize.width; w++) {
    const wOffsetX = direction === "north" || direction === "south" ? w : 0;
    const wOffsetZ = direction === "east" || direction === "west" ? w : 0;

    for (let i = firstStep; i <= rise; i++) {
      const basePosition = startPosition.offset(wOffsetX + i * offsetX, i, wOffsetZ + i * offsetZ);

      for (let h = tunnelSize.height; h >= 0; h--) {
        const digPosition = basePosition.offset(0, h, 0);
        if (stopTunnelAt(digPosition)) return false;
        const digResult = await breakBlockAt(digPosition.x, digPosition.y, digPosition.z);
        await __actionsDelay(digResult ? 1000 : 200);

        // The block under each step is the stair itself: keep it solid
        if (h === 0) {
          await ensureBlock(basePosition.offset(0, -1, 0));
        }
      }

      await pickupNearbyItems(bot);
      if (w === tunnelSize.width - 1) await torchStep(basePosition.offset(0, 2, 0), direction);
    }
  }
  return true;
}

/** Walks to a spot inside a tunnel it just dug (the path is clear, nothing to dig). */
async function walkTo(pos: Vec3): Promise<void> {
  await pathing.goto(new pf.goals.GoalBlock(pos.x, pos.y, pos.z));
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
