// Path: src/actions/blockPlacing.ts
// Placing one block: clears the spot, steps out of it, walks within reach and places it.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import * as gameData from "../utils/minecraftData";
import { giveCreativeItem, goTo, isReplaceable, knownBlock, placeBlockAt, withinReach } from "../core/primitives";
import { describeFailure, fail, wasStopped, type ActionResult } from "../core/result";
import { breakBlockAtResult } from "./blockBreaking";

const FACE_BY_NAME: Record<string, Vec3> = {
  top: new Vec3(0, 1, 0),
  bottom: new Vec3(0, -1, 0),
  north: new Vec3(0, 0, -1),
  south: new Vec3(0, 0, 1),
  east: new Vec3(1, 0, 0),
  west: new Vec3(-1, 0, 0),
};
// Things that can go where the bot stands (no need to step back first)
const PLACE_WHILE_STANDING = new Set([
  "torch", "redstone_torch", "redstone", "lever", "button", "rail", "detector_rail",
  "powered_rail", "activator_rail", "tripwire_hook", "tripwire", "water_bucket",
]);

/**
 * Places the exact item `blockType` at x, y, z: breaks what's in the way,
 * steps back if it stands there, walks within reach, and places it against
 * the side named by `placeOn` (or any solid side). Returns whether the block
 * is really there; placeBlockResult says why not.
 */
export async function placeBlock(blockType: string, x: number, y: number, z: number, placeOn: string = "bottom"): Promise<boolean> {
  return (await placeBlockResult(blockType, x, y, z, placeOn)).ok;
}

/** placeBlock, with the reason when it didn't work. */
export async function placeBlockResult(blockType: string, x: number, y: number, z: number, placeOn: string = "bottom"): Promise<ActionResult<{ name: string }>> {
  const targetDest = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
  const done = (result: ActionResult<{ name: string }>): ActionResult<{ name: string }> => {
    if (result.ok) console.log(`Placed ${blockType} at ${targetDest}.`);
    else console.log(`Failed to place ${blockType} at ${targetDest}: ${describeFailure(result)}`);
    return result;
  };

  // The exact block to place: "stone" must never pick a stone pickaxe
  if (!bot.inventory.items().some((item) => item.name === blockType) && bot.game.gameMode === "creative") {
    await giveCreativeItem(36, gameData.makeItem(blockType, 1)); // 36 is first hotbar slot
  }
  if (!bot.inventory.items().some((item) => item.name === blockType)) return done(fail("missing_items", `no ${blockType}`));

  const targetBlock = knownBlock(targetDest);
  if (!targetBlock) return done(fail("unknown_block", `${targetDest} isn't loaded`));
  if (targetBlock.name === blockType) return done(fail("occupied", `${blockType} is already there`));

  // Something solid in the way: break it first
  if (!isReplaceable(targetBlock)) {
    console.log(`${targetBlock.name} is in the way at ${targetBlock.position}.`);
    const cleared = await breakBlockAtResult(targetDest.x, targetDest.y, targetDest.z);
    if (!cleared.ok) return done(cleared);
  }

  // Standing in the spot: step back (blocks can't go where the bot is). Its
  // body is 0.6 wide and 1.8 tall: only a real overlap counts. Measuring from
  // the block's corner took the next cell for this one, so it walked away up
  // its stairs and sealed its shelter from the outside.
  if (!PLACE_WHILE_STANDING.has(blockType) && bodyOverlaps(targetDest)) {
    const away = await goTo(new pf.goals.GoalInvert(new pf.goals.GoalNear(targetDest.x, targetDest.y, targetDest.z, 2)));
    if (!away.ok && wasStopped(away)) return done(away);
  }

  // Too far: walk within reach
  if (!withinReach(targetDest)) {
    const near = await goTo(new pf.goals.GoalNear(targetDest.x, targetDest.y, targetDest.z, 3));
    if (!near.ok) return done(near);
  }

  const against = placeOn === "side" ? undefined : FACE_BY_NAME[placeOn];
  const first = await placeBlockAt(blockType, targetDest, { against });
  // The spot was in reach but the block it goes against wasn't: closer, once more
  if (!first.ok && first.reason === "out_of_reach") {
    const closer = await goTo(new pf.goals.GoalNear(targetDest.x, targetDest.y, targetDest.z, 2));
    if (closer.ok) return done(await placeBlockAt(blockType, targetDest, { against }));
  }
  return done(first);
}

/** True when the bot's body (0.6 x 1.8) overlaps the block cell at `cell`. */
export function bodyOverlaps(cell: Vec3, at: Vec3 = bot.entity.position): boolean {
  const half = 0.3;
  return (
    at.x + half > cell.x && at.x - half < cell.x + 1 &&
    at.z + half > cell.z && at.z - half < cell.z + 1 &&
    at.y + 1.8 > cell.y && at.y < cell.y + 1
  );
}
