// Path: src/skills/shelter.ts
// A first shelter, like a player's first night (Phase 6): a staircase down
// (the owner's diagonal tunnel; the stone it digs is the cobblestone for stone
// tools), then a 3x3 room, 2 high, at the bottom. At night the bot goes in and
// seals the bottom of the stairs with three blocks from inside; in the
// morning it opens them again. Mobs don't spawn near a player, so a sealed
// room is safe. Where: at its base if it has one nearby, else where it is.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { goTo, knownBlock } from "../core/primitives";
import { fail, ok, type ActionResult } from "../core/result";
import { report } from "../core/narrator";
import { recordScaffold } from "../core/scaffold";
import { addPlace, getBaseLocation } from "../managers/persistenceManager";
import { digDiagonalTunnel, digStraightTunnel, directionToward, type DirectionType } from "../actions/digging";
import { breakBlockAtResult, placeBlockResult } from "../actions/worldInteraction";
import { ensurePickaxe } from "../actions/ensureTools";
import { shelter } from "./capabilities";

const DEPTH = 5;
const ROOM_LENGTH = 3;
const BASE_NEAR = 64;
const FILLERS = ["cobblestone", "cobbled_deepslate", "dirt", "stone", "deepslate", "andesite", "diorite", "granite", "tuff"];
const STEP: Record<DirectionType, { x: number; z: number }> = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };

/** The shape of a shelter dug from `start` going `dir` (pure: tested on its own). */
export function shelterLayout(start: { x: number; y: number; z: number }, dir: DirectionType) {
  const s = STEP[dir];
  const bottom = new Vec3(start.x + s.x * DEPTH, start.y - DEPTH, start.z + s.z * DEPTH);
  return {
    bottom,
    // The last stair cell: three blocks seal it
    seal: [bottom, bottom.offset(0, 1, 0), bottom.offset(0, 2, 0)],
    // The room's middle (the room runs 1..3 past the bottom, 3 wide)
    center: bottom.offset(s.x * 2, 0, s.z * 2),
  };
}

/** The direction the bot faces (yaw 0 is north, PI/2 west). */
function facing(): DirectionType {
  const yaw = bot.entity.yaw;
  return directionToward(-Math.sin(yaw), -Math.cos(yaw));
}

/** Digs the shelter (stairs and room) and remembers it. */
export async function buildShelter(): Promise<ActionResult> {
  if (shelter()) return ok();
  if (!(await ensurePickaxe())) return fail("no_tool", "no pickaxe to dig a shelter");
  // At its base when it has one close by
  const base = getBaseLocation();
  if (base && bot.entity.position.distanceTo(new Vec3(base.x, base.y, base.z)) <= BASE_NEAR) {
    const walked = await goTo(new pf.goals.GoalNear(base.x, base.y, base.z, 2));
    if (!walked.ok) console.log("Couldn't get to the base; digging the shelter here.");
  }
  const start = bot.entity.position.floored();
  const dir = facing();
  const layout = shelterLayout(start, dir);
  report("Digging a shelter for the night.");
  if (!(await digDiagonalTunnel(dir, DEPTH, { width: 1, height: 2 }, start, "basementEntrance"))) {
    return fail("refused", "the stairs hit lava, water or something built");
  }
  if (!(await digStraightTunnel(dir, ROOM_LENGTH, layout.bottom, 3))) return fail("refused", "the room hit lava, water or something built");
  await addPlace({ kind: "basement", name: "shelter", ...layout.center, details: { seal: layout.seal.map((p) => ({ x: p.x, y: p.y, z: p.z })), direction: dir } });
  console.log(`Shelter dug: room at ${layout.center}.`);
  return ok();
}

type Pos = { x: number; y: number; z: number };
const sealOf = (room: { details?: Record<string, unknown> }): Pos[] => ((room.details?.["seal"] as Pos[] | undefined) ?? []);

/** Goes into the shelter and seals the stairs behind it. */
export async function enterShelter(): Promise<ActionResult> {
  const room = shelter();
  if (!room) return fail("not_found", "no shelter");
  const walked = await goTo(new pf.goals.GoalBlock(room.x, room.y, room.z));
  if (!walked.ok) return walked;
  for (const p of sealOf(room)) {
    const here = knownBlock(p);
    if (!here || here.boundingBox === "block") continue; // already closed
    const filler = FILLERS.find((n) => bot.inventory.items().some((i) => i.name === n));
    if (!filler) return fail("missing_items", "nothing to seal the door with");
    const placed = await placeBlockResult(filler, p.x, p.y, p.z, "side");
    // Its own block: walking out later may dig through it
    if (placed.ok) recordScaffold(p, placed.value.name);
  }
  return ok();
}

/** Opens the sealed stairs again (in the morning). */
export async function leaveShelter(): Promise<ActionResult> {
  const room = shelter();
  if (!room) return ok();
  for (const p of sealOf(room)) {
    const here = knownBlock(p);
    if (!here || here.boundingBox !== "block") continue;
    const broken = await breakBlockAtResult(p.x, p.y, p.z);
    if (!broken.ok) return broken;
  }
  return ok();
}
