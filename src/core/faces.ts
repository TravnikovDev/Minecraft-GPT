// Path: src/core/faces.ts
// Keeps the bot's body off a block face after the server places it.
//
// The server puts a player back at, say, x = -32.3: its body's side is then
// exactly on the block face at -32.0. In floating point -32.3 + 0.3 is
// -31.999999999999996, a hair inside the block, and mineflayer's physics
// only stops the body at blocks it isn't already in: it walks 0.009 into the
// block, the server refuses that move and puts it back at -32.3, twenty times
// a second. The bot hung at stair steps and ledges it could plainly climb
// (owner: "THERE ARE WALKABLE PATH"; "server moved me back 373 times").

import { Vec3 } from "vec3";
import { bot, listen } from "./body";

const HALF_WIDTH = 0.3;
const HEIGHT = 1.8;
// Only rounding hairs: a real overlap is the server's business
const HAIR = 1e-4;
// How far off the face it ends up (far below what the server checks)
const CLEARANCE = 1e-6;

export type Box = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };

/**
 * Where the body at `pos` stands once pushed out of any block it overlaps by
 * a rounding hair (sideways only: x and z). Pure.
 */
export function offTheFaces(pos: { x: number; y: number; z: number }, blocks: Box[]): { x: number; z: number } {
  let { x, z } = pos;
  for (const b of blocks) {
    const minX = x - HALF_WIDTH, maxX = x + HALF_WIDTH, minZ = z - HALF_WIDTH, maxZ = z + HALF_WIDTH;
    const minY = pos.y, maxY = pos.y + HEIGHT;
    // Overlapping at all (strictly)?
    if (!(maxX > b.minX && minX < b.maxX && maxZ > b.minZ && minZ < b.maxZ && maxY > b.minY && minY < b.maxY)) continue;
    // Depth into the block from each side; only a hair counts
    const depths: Array<[number, () => void]> = [
      [maxX - b.minX, () => (x = b.minX - HALF_WIDTH - CLEARANCE)],
      [b.maxX - minX, () => (x = b.maxX + HALF_WIDTH + CLEARANCE)],
      [maxZ - b.minZ, () => (z = b.minZ - HALF_WIDTH - CLEARANCE)],
      [b.maxZ - minZ, () => (z = b.maxZ + HALF_WIDTH + CLEARANCE)],
    ];
    const [depth, push] = depths.reduce((a, c) => (c[0] < a[0] ? c : a));
    // A hair into a floor or ceiling is the physics' business, not a side
    // push off an edge (architect review)
    const vertical = Math.min(maxY - b.minY, b.maxY - minY);
    if (depth < HAIR && depth <= vertical) push();
  }
  return { x, z };
}

/** The collision boxes of the blocks around the bot's body. */
function blocksAround(pos: Vec3): Box[] {
  const boxes: Box[] = [];
  for (let x = Math.floor(pos.x - HALF_WIDTH) - 1; x <= Math.floor(pos.x + HALF_WIDTH) + 1; x++)
    for (let y = Math.floor(pos.y) - 1; y <= Math.floor(pos.y + HEIGHT); y++)
      for (let z = Math.floor(pos.z - HALF_WIDTH) - 1; z <= Math.floor(pos.z + HALF_WIDTH) + 1; z++) {
        const block = bot.blockAt(new Vec3(x, y, z), false);
        for (const s of (block?.shapes ?? []) as number[][]) {
          boxes.push({ minX: x + s[0]!, minY: y + s[1]!, minZ: z + s[2]!, maxX: x + s[3]!, maxY: y + s[4]!, maxZ: z + s[5]! });
        }
      }
  return boxes;
}

/** Off any block face it is a hair inside. */
function unstick(): void {
  if (!bot.entity || bot.vehicle) return;
  const pos = bot.entity.position;
  const fixed = offTheFaces(pos, blocksAround(pos));
  if (fixed.x !== pos.x || fixed.z !== pos.z) pos.set(fixed.x, pos.y, fixed.z);
}

/**
 * After every server teleport and every physics step (before the position
 * goes to the server): off any block face it ended up a hair inside.
 */
export function registerFaceFix(): void {
  // Through listen(): per connection, and a throw never lands in mineflayer's physics loop
  listen(bot, "forcedMove", unstick);
  listen(bot, "physicsTick", unstick);
}
