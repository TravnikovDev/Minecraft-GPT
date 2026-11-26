import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import pf from "mineflayer-pathfinder";
import { Block } from "prismarine-block";
import * as world from "./world.js";
import { __actionsDelay } from "../utils/utility.js";
import { breakBlockAtResult, replaceBrokenTool } from "./blockBreaking.js";
import { pickupNearbyItems } from "./pickup.js";
import { tellOwner } from "../managers/ownerDialog";
import { pathing, tools } from "../core/plugins";
import { goTo } from "../core/primitives";
import { ActionError, expectOk, wasStopped, type ActionResult } from "../core/result";
import { canSee, openFaces, type SightWorld } from "./sight";
import { isCommandCancelled, reportProgress } from "../core/commandContext";
import { forbiddenAt } from "../core/forbidden";
import { isProtected } from "../core/movements";
import { recordSighting } from "./perception";
import { tunnelTo } from "./digging";
import { makeRoom } from "./overflow";

// Walking prefers to go around (digCost 6); a miner expects to dig
const MINING_DIG_COST = 1;
// How far it notices an open ore, and how many candidates it checks for that
const SIGHT_RANGE = 48;
// Give up after this many failed tries in a row (unreachable, wrong tool...)
const MAX_FAILURES = 5;
const MAX_SIGHT_CHECKS = 200;

/**
 * Which block to go for, like a player: the nearest one it can see (open to
 * air, clear line from its eyes), and only when none is in sight the nearest
 * one overall, which it tunnels to. `blocks` is sorted nearest first.
 */
function chooseTarget(blocks: Block[], blockType: string, seenOnly = false): { block: Block; seen: boolean } | null {
  // @ts-ignore - eyeHeight exists at runtime (mineflayer sets it) but is not in the Entity type
  const eyes = bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0);
  const world = bot.world as unknown as SightWorld;
  // Only blocks with a face open to air can be seen at all: check those first
  // (the nearest 200 stone blocks are all buried, so an exposed cliff a bit
  // farther away was never even looked at)
  const open = blocks.filter((b) => openFaces(world, b).length > 0);
  const seen = open.slice(0, MAX_SIGHT_CHECKS).find((b) => canSee(world, eyes, b, SIGHT_RANGE));
  if (seen) {
    console.log(`Going for the ${seen.name} I can see at ${seen.position}.`);
    return { block: seen, seen: true };
  }
  if (seenOnly) {
    console.log(`No ${blockType} in sight (and not tunnelling for it here).`);
    return null;
  }
  console.log(`No ${blockType} in sight; tunnelling to the nearest one at ${blocks[0].position}.`);
  return { block: blocks[0], seen: false };
}

export async function collectBlock(
  blockType: string,
  num = 1,
  range = 16,
  options: { seenOnly?: boolean } = {}
): Promise<number> {
  if (num < 1) {
    console.log(`Invalid number of blocks to collect: ${num}.`);
    return 0;
  }

  // A block by name, or an item that comes from ores ("diamond", "raw_iron",
  // "coal"): mine every ore that drops it (stone and deepslate variants)
  const c = catalog();
  let blockTypes = c.isBlock(blockType) ? [blockType] : [];
  if (blockTypes.length === 0 && c.isItem(blockType)) blockTypes = c.oresFor(blockType);
  if (c.isBlock(`deepslate_${blockType}`) && blockType.endsWith("_ore")) blockTypes.push(`deepslate_${blockType}`);
  if (blockTypes.length === 0) {
    console.log(`"${blockType}" is not a block or anything ores drop.`);
    return 0;
  }
  // What a player asks for is often the drop, not the block: cobblestone comes
  // from stone, cobbled deepslate from deepslate, dirt from grass too
  const FROM: Record<string, string[]> = { cobblestone: ["stone"], cobbled_deepslate: ["deepslate"], dirt: ["grass_block"] };
  for (const source of FROM[blockType] ?? []) if (c.isBlock(source) && !blockTypes.includes(source)) blockTypes.push(source);

  let collected = 0;
  let failures = 0;
  // Ores its tunnel couldn't reach (lava, something built in the way)
  const badTargets = new Set<string>();

  while (collected < num) {
    // A stopped command must end here; otherwise every retry fails with
    // "Cancelled" and the loop spins forever (seen in the game after "stop")
    if (isCommandCancelled()) {
      console.log(`Collecting ${blockType} cancelled.`);
      break;
    }
    if (failures >= MAX_FAILURES) {
      console.log(`Giving up on ${blockType} after ${failures} failed tries.`);
      break;
    }
    // Not ones it gave up on, nor ones in an area it must keep out of.
    // Never its shelter's or stairs' walls (protected), but ore in them is
    // fair game: mined, then the spot filled back (owner)
    let blocks = world.getNearestBlocks(blockTypes, range).filter((b) => !badTargets.has(b.position.toString()) && !forbiddenAt(b.position) && (!isProtected(b.position) || c.isOre(b.name)));
    for (const b of blocks.slice(0, 8)) recordSighting(b.name, b.position); // hints for later

    if (blocks.length === 0) {
      if (collected === 0) console.log(`No ${blockType} nearby to collect.`);
      else console.log(`No more ${blockType} nearby to collect.`);
      break;
    }

    // seenOnly: blocks it can see from here, never a tunnel to a buried one
    const target = chooseTarget(blocks, blockType, options.seenOnly);
    if (!target) break;
    const { block, seen } = target;

    try {
      // Equip appropriate tool
      if (bot.game.gameMode !== "creative") {
        await tools.equipForBlock(block);
        const itemId = bot.heldItem ? bot.heldItem.type : null;
        if (!block.canHarvest(itemId)) {
          console.log(`Don't have right tools to harvest ${block.name}.`);
          // The pickaxe broke (or it never had the right one): make one and go on
          if (catalog().toolKindFor(block.name) === "pickaxe" && (await replaceBrokenTool(block))) continue;
          tellOwner(`I need a better pickaxe to mine ${block.name.replace(/_/g, " ")}, and I can't make one from what I have.`);
          break;
        }
      }

      // Buried: tunnel to it like a miner (diagonal tunnel to its level,
      // then straight), instead of letting the path search dig its own way
      if (!seen && !(await tunnelTo(block.position, block.name.replace(/_/g, " ")))) {
        badTargets.add(block.position.toString());
        throw new Error(`couldn't tunnel to the ${block.name} at ${block.position}`);
      }

      // Implement vein mining
      // seenOnly: an ore's vein is fine (it uncovers as it goes), but plain
      // stone would follow into the hillside, carving a hole (architect review)
      const isOre = c.isOre(block.name);
      const veinBlocks = options.seenOnly && !isOre ? [block] : findVeinBlocks(block, num, range, 1);

      for (const veinBlock of veinBlocks) {
        if (collected >= num) break;

        // Move to the block using pathfinder
        const goal = new pf.goals.GoalGetToBlock(
          veinBlock.position.x,
          veinBlock.position.y,
          veinBlock.position.z
        );
        // Mining digs cheaply, so the path search finds stairs down to an
        // ore instead of timing out (the walking rules forbid shafts). Not
        // for what it can see: it walks there like anyone, no digging its way
        expectOk(options.seenOnly ? await goTo(goal) : await pathing.withRules({ digCost: MINING_DIG_COST }, () => goTo(goal)));

        // Break the block and collect drops; only a block really broken counts
        const mined = await mineAndCollect(veinBlock);
        if (!mined.ok) {
          if (wasStopped(mined)) break;
          // A protected area (or one it can't harvest): don't come back to it
          badTargets.add(veinBlock.position.toString());
          throw new ActionError(mined);
        }
        if (mined.value.alreadyGone) continue; // someone else got it
        collected++;
        reportProgress(collected); // cut off now, it collects only what's left
        failures = 0;

        // Full: put things away (in a chest it knows, or one it makes) and go on
        if (bot.inventory.emptySlotCount() === 0 && !(await makeRoom(`collect more ${blockType.replace(/_/g, " ")}`, blockTypes.flatMap((b) => [b, ...c.dropsOf(b)])))) {
          console.log("Inventory is full, cannot collect more items.");
          break;
        }
      }
    } catch (err) {
      console.log(`Failed to collect ${blockType}: ${err}.`);
      failures++;
      continue;
    }
  }

  console.log(`Collected ${collected} ${blockType}(s).`);
  return collected; // how many it really got (0: none)
}

/** Mines one block (checked) and picks up what it drops. */
async function mineAndCollect(block: Block): Promise<ActionResult<{ name: string; alreadyGone: boolean }>> {
  const kept = isProtected(block.position);
  const broken = await breakBlockAtResult(block.position.x, block.position.y, block.position.z);
  if (broken.ok && !broken.value.alreadyGone) await pickupNearbyItems(bot, 5);
  // Ore taken out of a wall or a step it keeps: the spot filled back
  if (broken.ok && kept) await fillBack(block.position);
  return broken;
}

// What a mined-out spot in a kept wall or step is filled with
const FILL_BACK = ["cobblestone", "cobbled_deepslate", "stone", "deepslate", "andesite", "diorite", "granite", "tuff", "dirt"];

/** Fills a spot of a kept wall or step that ore was mined out of. */
async function fillBack(p: { x: number; y: number; z: number }): Promise<void> {
  const filler = FILL_BACK.find((n) => bot.inventory.items().some((i) => i.name === n));
  if (!filler) {
    console.log(`Mined ore out of my wall at ${p}; nothing to fill it back with yet.`);
    return;
  }
  const { placeBlockResult } = await import("./blockPlacing");
  const placed = await placeBlockResult(filler, p.x, p.y, p.z);
  console.log(placed.ok ? `Filled the spot at ${p} back with ${filler}.` : `Couldn't fill the spot at ${p} back (${placed.ok ? "" : placed.detail}).`);
}

// Function to find connected blocks (vein mining)
function findVeinBlocks(
  startBlock: Block,
  maxBlocks = 100,
  maxDistance = 16,
  floodRadius = 1
): Block[] {
  const veinBlocks: Block[] = [];
  const visited = new Set<string>();
  const queue: Block[] = [startBlock];

  while (queue.length > 0 && veinBlocks.length < maxBlocks) {
    const block = queue.shift();
    if (!block) continue;
    const key = block.position.toString();

    if (visited.has(key)) continue;
    visited.add(key);

    if (block.name !== startBlock.name) continue;
    if (block.position.distanceTo(startBlock.position) > maxDistance) continue;

    veinBlocks.push(block);

    // Check neighboring blocks within floodRadius
    for (let dx = -floodRadius; dx <= floodRadius; dx++) {
      for (let dy = -floodRadius; dy <= floodRadius; dy++) {
        for (let dz = -floodRadius; dz <= floodRadius; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue; // Skip the current block
          const neighborPos = block.position.offset(dx, dy, dz);
          const neighborBlock = bot.blockAt(neighborPos);
          if (neighborBlock && !visited.has(neighborPos.toString())) {
            queue.push(neighborBlock);
          }
        }
      }
    }
  }

  return veinBlocks;
}
