// Path: src/actions/doors.ts
// Doors on the way: the path search treats wooden doors as passable (see
// core/movements.ts). When the bot's planned route goes through a closed door
// right in front of it, this opens it; once the bot has walked through to the
// other side (or clearly gone elsewhere), it closes it again, so the owner's
// house stays shut against mobs.
//
// Only doors on the route are touched: a bot following the owner stops a few
// blocks short, and closing a door it never went through (then reopening it
// when the owner moves) made it flap the door open and shut.

import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { bot, onConnectionEnd } from "../core/body";
import { isWoodenDoor, markDoorSolid } from "../core/movements";
import { pathing } from "../core/plugins";
import { useBlock } from "../core/primitives";
import { holderOf, runAs } from "../core/leases";

const CHECK_MS = 150;
const OPEN_RANGE = 2.2; // open a door on the route this close to the bot
const ROUTE_NODES = 6; // how far along the planned route to look for doors
const CLEAR_OF_DOOR = 1.5; // through: this far past the door's middle line
const GAVE_UP_AFTER = 6; // never went through and walked off: close anyway
const FORGET_AFTER = 12; // too far to bother closing

type Opened = { pos: Vec3; axis: "x" | "z"; startSide: number };

// Doors the bot opened (lower half positions), to close behind it
const openedByBot = new Map<string, Opened>();
// The pathfinder's live route. Kept by reference, not copied: the pathfinder
// shifts nodes off this array as the bot walks, so it stays current between
// replans (a copy goes stale, and a door further along was never "on route")
let route: Array<{ x: number; y: number; z: number }> = [];
let busy = false;

const key = (p: Vec3): string => `${p.x},${p.y},${p.z}`;
const isOpen = (door: Block): boolean => door.getProperties()["open"] === true;

/** The lower half of a door (both halves open together; one position per door). */
function lowerHalf(door: Block): Block {
  if (door.getProperties()["half"] === "upper") return bot.blockAt(door.position.offset(0, -1, 0)) ?? door;
  return door;
}

/** The axis the bot crosses when walking through a door (doors facing north/south are crossed along z). */
function crossingAxis(door: Block): "x" | "z" {
  const facing = String(door.getProperties()["facing"] ?? "north");
  return facing === "north" || facing === "south" ? "z" : "x";
}

/** Which side of the door's middle line the bot is on (-1 or 1), and how far. */
function sideOf(opened: { pos: Vec3; axis: "x" | "z" }): { side: number; depth: number } {
  const offset = bot.entity.position[opened.axis] - (opened.pos[opened.axis] + 0.5);
  return { side: Math.sign(offset) || 1, depth: Math.abs(offset) };
}

/** True when the bot's planned route (from where it stands) passes through this door. */
function onRoute(door: Vec3): boolean {
  const points = [bot.entity.position, ...route.slice(0, ROUTE_NODES).map((p) => new Vec3(p.x, p.y, p.z))];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 0.25));
    for (let s = 0; s <= steps; s++) {
      const p = a.plus(b.minus(a).scaled(s / steps));
      if (Math.floor(p.x) === door.x && Math.floor(p.z) === door.z && Math.abs(Math.floor(p.y) - door.y) <= 1) return true;
    }
  }
  return false;
}

/** A closed wooden door on the route, close to the bot. */
function doorToOpen(): Block | null {
  const pos = bot.entity.position;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (const dy of [0, 1]) {
        const block = bot.blockAt(pos.offset(dx, dy, dz));
        if (!block || !isWoodenDoor(block.name)) continue;
        const door = lowerHalf(block);
        if (isOpen(door)) continue;
        if (door.position.offset(0.5, 0, 0.5).distanceTo(pos) > OPEN_RANGE) continue;
        if (onRoute(door.position)) return door;
      }
    }
  }
  return null;
}

/** Waits briefly for the server to show the door open. */
async function becameOpen(pos: Vec3): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    const door = bot.blockAt(pos);
    if (door && isWoodenDoor(door.name) && isOpen(door)) return true;
    await new Promise((r) => setTimeout(r, 75));
  }
  return false;
}

/** Should the bot close a door it opened? Through it and clear, or gone elsewhere. */
function shouldClose(opened: Opened, distance: number): boolean {
  if (pathing.isMoving() && onRoute(opened.pos)) return false; // still about to use it
  const { side, depth } = sideOf(opened);
  if (side !== opened.startSide) return depth >= CLEAR_OF_DOOR;
  return distance >= GAVE_UP_AFTER;
}

async function tick(): Promise<void> {
  if (busy || !bot.entity || bot.vehicle) return;
  busy = true;
  try {
    // Open a closed door the route goes through
    if (pathing.isMoving()) {
      const door = doorToOpen();
      if (door) {
        const opened = { pos: door.position.clone(), axis: crossingAxis(door), startSide: 0 };
        opened.startSide = sideOf(opened).side;
        await useBlock(door);
        if (await becameOpen(door.position)) {
          openedByBot.set(key(door.position), opened);
          console.log(`Opened the door at ${door.position}.`);
        } else {
          // The server refused (protected area, adventure mode): route around it
          markDoorSolid(door.position);
          pathing.replan(); // the route goes around it now
          console.log(`The door at ${door.position} won't open; finding another way.`);
        }
      }
    }
    // Close doors behind the bot once it's through
    for (const [k, opened] of openedByBot) {
      const distance = bot.entity.position.distanceTo(opened.pos.offset(0.5, 0, 0.5));
      if (distance > FORGET_AFTER) {
        openedByBot.delete(k);
        continue;
      }
      if (!shouldClose(opened, distance)) continue;
      openedByBot.delete(k);
      const door = bot.blockAt(opened.pos);
      if (!door || !isWoodenDoor(door.name) || !isOpen(door)) continue; // someone closed it already
      await useBlock(door);
      console.log(`Closed the door at ${opened.pos} behind me.`);
    }
  } catch (error) {
    console.log(`Door opener: ${(error as Error).message}`);
  } finally {
    busy = false;
  }
}

/** Starts the door opener for the current bot instance. */
export function registerDoorOpener(): void {
  openedByBot.clear();
  route = [];
  busy = false;
  const onPath = (results: { path: Array<{ x: number; y: number; z: number }> }): void => {
    route = results.path;
  };
  const onDone = (): void => {
    route = [];
  };
  bot.on("path_update", onPath);
  bot.on("goal_reached", onDone);
  bot.on("path_stop", onDone);
  // Doors are opened for whoever is walking: the task, or a reflex running
  // from mobs (which would otherwise wait for itself to finish)
  const timer = setInterval(() => void runAs(holderOf("movement") ?? { name: "idle", bucket: 6 }, tick), CHECK_MS);
  onConnectionEnd(bot, () => {
    clearInterval(timer);
    bot.off("path_update", onPath);
    bot.off("goal_reached", onDone);
    bot.off("path_stop", onDone);
  });
}
