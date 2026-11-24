// Path: src/actions/doors.ts
// Doors on the way: the path search treats wooden doors as passable (see
// core/movements.ts), so when the bot walks up to a closed door in front of
// it, this opens it, and once the bot is through and a few steps away, closes
// it again (the owner's house stays shut against mobs).

import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { isWoodenDoor } from "../core/movements";
import { pathing } from "../core/plugins";

const CHECK_MS = 150;
const OPEN_RANGE = 1.8; // a door this close in front of the bot gets opened
const CLOSE_AFTER = 2.6; // close it again once the bot is this far away
const FORGET_AFTER = 10; // too far to bother closing

// Doors the bot opened (lower half positions), to close behind it
const openedByBot = new Map<string, Vec3>();
let busy = false;

const key = (p: Vec3): string => `${p.x},${p.y},${p.z}`;
const isOpen = (door: Block): boolean => door.getProperties()["open"] === true;

/** The lower half of a door (both halves open together; one position per door). */
function lowerHalf(door: Block): Block {
  if (door.getProperties()["half"] === "upper") return bot.blockAt(door.position.offset(0, -1, 0)) ?? door;
  return door;
}

/** Closed wooden doors right in front of the bot. */
function doorAhead(): Block | null {
  const pos = bot.entity.position;
  // mineflayer yaw: 0 faces north (-z)
  const facing = new Vec3(-Math.sin(bot.entity.yaw), 0, -Math.cos(bot.entity.yaw));
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (const dy of [0, 1]) {
        const block = bot.blockAt(pos.offset(dx, dy, dz));
        if (!block || !isWoodenDoor(block.name)) continue;
        const door = lowerHalf(block);
        if (isOpen(door)) continue;
        const center = door.position.offset(0.5, 0, 0.5);
        const toDoor = center.minus(pos);
        toDoor.y = 0;
        const distance = toDoor.norm();
        if (distance > OPEN_RANGE) continue;
        if (distance > 0.3 && toDoor.scaled(1 / distance).dot(facing) < 0.5) continue; // not in front
        return door;
      }
    }
  }
  return null;
}

async function tick(): Promise<void> {
  if (busy || !bot.entity || bot.vehicle) return;
  busy = true;
  try {
    // Open a closed door the bot is walking into
    if (pathing.isMoving()) {
      const door = doorAhead();
      if (door) {
        await bot.activateBlock(door);
        openedByBot.set(key(door.position), door.position.clone());
        console.log(`Opened the door at ${door.position}.`);
      }
    }
    // Close doors behind the bot once it's through
    for (const [k, p] of openedByBot) {
      const distance = bot.entity.position.distanceTo(p.offset(0.5, 0, 0.5));
      if (distance < CLOSE_AFTER) continue;
      openedByBot.delete(k);
      const door = bot.blockAt(p);
      if (distance > FORGET_AFTER || !door || !isWoodenDoor(door.name) || !isOpen(door)) continue;
      await bot.activateBlock(door);
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
  busy = false;
  const timer = setInterval(() => void tick(), CHECK_MS);
  bot.once("end", () => clearInterval(timer));
}
