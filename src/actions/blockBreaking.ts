// Path: src/actions/blockBreaking.ts
// Breaking one block: walks within reach, digs with the best tool and makes a new tool when the old one broke.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import type { Block } from "prismarine-block";
import { bot } from "../core/body";
import { getMemory } from "../managers/persistenceManager";
import { catalog } from "../core/catalog";
import { pathing, tools } from "../core/plugins";
import { breakBlock, goTo, knownBlock, withinReach } from "../core/primitives";
import { describeFailure, fail, ok, type ActionResult } from "../core/result";
import { inChore } from "../core/chores";

let replacingTool = false;

/**
 * The right tool for `block` wore out (or it never had one): crafts a new one
 * from what it carries, the best it can, like a player does when a pickaxe
 * breaks mid-mine, and equips it. Never recursive: making the tool can't
 * start making another. Returns true if it can now harvest the block.
 */
export async function replaceBrokenTool(block: Block): Promise<boolean> {
  const kind = catalog().toolKindFor(block.name);
  // Never for an idle chore: crafting a tool can mean fetching wood far away
  if (replacingTool || inChore() || (kind !== "pickaxe" && kind !== "axe" && kind !== "shovel")) return false;
  replacingTool = true;
  try {
    // Only from what it carries (never going off for wood or stone: if it
    // can't, the "no_tool" failure goes up and the planner sorts it out)
    const { craftNow, planCraft } = await import("./craftPlanner");
    // Never back down to wood once it has had stone tools (a stone pickaxe
    // breaking in the mine must not turn into a wooden one; owner's rule)
    const hadStone = Boolean(getMemory().milestones?.["stone_tools"]);
    const best = ["netherite", "diamond", "iron", "stone", ...(hadStone ? [] : ["wooden"])]
      .map((tier) => `${tier}_${kind}`)
      .find((item) => bot.registry.itemsByName[item] && planCraft(item, 1).missing.length === 0);
    if (!best) return false;
    console.log(`No ${kind} that can break ${block.name}: making a ${best.replace(/_/g, " ")}.`);
    // A stone pickaxe for the mine: a few at once when it can (owner: in bulk,
    // 3 in the bag; it walked to a table for each one)
    const n = kind === "pickaxe" && best === "stone_pickaxe" ? ([3, 2].find((k) => planCraft(best, k).missing.length === 0) ?? 1) : 1;
    if (!(await craftNow(best, n)).ok) return false;
    await tools.equipForBlock(block);
    return block.canHarvest(bot.heldItem ? bot.heldItem.type : null);
  } catch (error) {
    console.log(`Making a new ${kind} failed: ${(error as Error).message}`);
    return false;
  } finally {
    replacingTool = false;
  }
}

/**
 * Breaks the block at x, y, z: walks within reach (building up to it if it's
 * high, like a treetop), takes the best tool (or makes one if the old one
 * broke, never for an idle chore), digs, and checks it's really gone.
 * Returns false for air or liquid (nothing to break), as before.
 */
export async function breakBlockAt(x: number, y: number, z: number): Promise<boolean> {
  const result = await breakBlockAtResult(x, y, z);
  return result.ok && !result.value.alreadyGone;
}

/** breakBlockAt, with the reason when it didn't break it. */
export async function breakBlockAtResult(
  x: number,
  y: number,
  z: number
): Promise<ActionResult<{ name: string; alreadyGone: boolean }>> {
  if (x == null || y == null || z == null) throw new Error("Invalid position to break block at.");
  const blockPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
  const block = knownBlock(blockPos);
  if (!block) {
    console.log(`No block known at ${blockPos} (not loaded).`);
    return fail("unknown_block", `${blockPos} isn't loaded`);
  }
  if (block.boundingBox === "empty" && ["air", "cave_air", "water", "lava"].includes(block.name)) {
    console.log(`Skipping block at ${blockPos} because it is ${block.name}.`);
    return ok({ name: block.name, alreadyGone: true });
  }
  if (!withinReach(blockPos)) {
    // Reaching a block up high (the top of a tree) is when a player builds up to it
    const walked = await pathing.withRules({ allow1by1towers: true }, () =>
      goTo(new pf.goals.GoalNear(blockPos.x, blockPos.y, blockPos.z, 2))
    );
    if (!walked.ok && !withinReach(blockPos)) {
      console.log(`Can't get to the ${block.name} at ${blockPos}: ${describeFailure(walked)}`);
      return walked;
    }
  }
  let result = await breakBlock(blockPos);
  // The pickaxe wore out, or it never had the right one: make one and try again
  if (!result.ok && result.reason === "no_tool" && (await replaceBrokenTool(block))) result = await breakBlock(blockPos);
  if (result.ok) console.log(`Broke ${block.name} at x:${blockPos.x}, y:${blockPos.y}, z:${blockPos.z}.`);
  else console.log(`Couldn't break the ${block.name} at ${blockPos}: ${describeFailure(result)}`);
  return result;
}
