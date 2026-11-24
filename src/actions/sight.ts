// Path: src/actions/sight.ts
// What the bot could see with its own eyes, so it acts like a player and not
// like x-ray: a block is "in sight" when one of its faces is open to air and
// nothing solid stands between the bot's eyes and that face.

import { Vec3 } from "vec3";
import type { Block } from "prismarine-block";

/** The world reads sight needs: bot.world (prismarine-world's sync view) or a test world. */
export type SightWorld = {
  getBlock(pos: Vec3): Block | null;
  raycast(from: Vec3, direction: Vec3, range: number): (Block & { position: Vec3 }) | null;
};

const OPEN = new Set(["air", "cave_air", "void_air"]);
const FACES = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

/** The directions in which this block touches air (its faces a player could see). */
export function openFaces(world: SightWorld, block: Block): Vec3[] {
  return FACES.filter((face) => OPEN.has(world.getBlock(block.position.plus(face))?.name ?? ""));
}

/**
 * True when the eyes have a clear line to one of the block's open faces.
 * (mineflayer's canSeeBlock aims at the block's centre only, so an ore with
 * one face open to a cave usually reads as hidden behind the stone next to it.)
 */
export function canSee(world: SightWorld, eyes: Vec3, block: Block, maxDistance: number): boolean {
  if (eyes.distanceTo(block.position.offset(0.5, 0.5, 0.5)) > maxDistance) return false;
  for (const face of openFaces(world, block)) {
    // The middle of that face, nudged into the block so the ray ends on it
    const target = block.position.offset(0.5 + face.x * 0.45, 0.5 + face.y * 0.45, 0.5 + face.z * 0.45);
    const toTarget = target.minus(eyes);
    const range = toTarget.norm() + 0.1;
    const hit = world.raycast(eyes, toTarget.normalize(), range);
    if (hit && hit.position.equals(block.position)) return true;
  }
  return false;
}

/** True when nothing solid stands between the eyes and a point (e.g. an animal's middle). */
export function canSeePoint(world: SightWorld, eyes: Vec3, point: Vec3, maxDistance: number): boolean {
  const toPoint = point.minus(eyes);
  const range = toPoint.norm(); // before normalize(), which changes the vector in place
  if (range > maxDistance) return false;
  return world.raycast(eyes, toPoint.normalize(), range) === null;
}
