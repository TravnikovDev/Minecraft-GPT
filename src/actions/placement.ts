// Path: src/actions/placement.ts
// Putting items from the inventory down in the world (beds, chests, tables...).

import type { Block } from "prismarine-block";
import { catalog } from "../core/catalog";
import { bot } from "../core/body";
import { goTo, lookAt } from "../core/primitives";
import { describeFailure, fail, ok, wasStopped, type ActionResult } from "../core/result";
import { breakBlockAt } from "./blockBreaking";
import { placeBlock, placeBlockResult } from "./blockPlacing";
import { getNearestFreeSpace } from "./world";
import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { loadBed } from "../core/session";
import { ownerEntity } from "../managers/ownerDialog";
import { isNatural, isProtected, nearOwnPassage } from "../core/movements";

/**
 * The inventory item to place for what the owner asked: an exact ID, or a
 * generic name like "bed" -> whichever *_bed the bot carries.
 */
export function findPlaceableItem(requested: string): string | null {
  const items = bot.inventory.items();
  const exact = items.find((i) => i.name === requested);
  if (exact) return exact.name;
  const singular = requested.replace(/s$/, "");
  const variant = items.find((i) => i.name.endsWith(`_${singular}`) || i.name === singular);
  return variant?.name ?? null;
}

/** Looks east along a free area, so a bed placed at `spot` puts its head inside it. */
async function faceAlong(spot: Vec3, size: number): Promise<void> {
  await lookAt(spot.offset(size, 0, 0));
}

/** Beds need two free blocks in a row; everything else one. */
function footprint(itemName: string): number {
  return catalog().isBed(itemName) ? 2 : 1;
}

/**
 * Places an item on free, solid ground near the bot. Returns the placed block,
 * or null if there was no room or the server refused.
 */
export async function placeItemNear(itemName: string): Promise<Block | null> {
  const result = await placeItemNearResult(itemName);
  return result.ok ? result.value : null;
}

/** placeItemNear, with the reason when it couldn't (no free spot, refused...). */
export async function placeItemNearResult(itemName: string): Promise<ActionResult<Block>> {
  const size = footprint(itemName);
  let last: ActionResult<Block> = fail("occupied", "no free spot nearby");
  for (let attempt = 0; attempt < 3; attempt++) {
    const spot = getNearestFreeSpace(size, 6 + attempt * 4);
    if (!spot) return last;
    // Face along the free area so a bed's head lands inside it too
    await faceAlong(spot, size);
    const placed = await placeBlockResult(itemName, spot.x, spot.y, spot.z);
    const block = bot.blockAt(spot);
    if (placed.ok && block?.name === itemName) return ok(block);
    last = placed.ok ? fail("refused", `the ${itemName} didn't stay at ${spot}`) : placed;
    if (wasStopped(last) || last.reason === "missing_items") return last;
    console.log(`Placing ${itemName} at ${spot} failed (attempt ${attempt + 1}): ${describeFailure(last)}`);
  }
  return last;
}

// --- A chest out of the way ---------------------------------------------------

const HORIZONTAL = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const LIQUIDS = new Set(["water", "lava"]);

/** True under a roof: something solid (not leaves) somewhere above the bot's head. */
export function underRoof(feet: Vec3, blockAt: BlockAt, height = 32): boolean {
  for (let y = 2; y <= height; y++) {
    const b = blockAt(feet.offset(0, y, 0));
    if (b && b.boundingBox === "block" && !b.name.endsWith("_leaves")) return true;
  }
  return false;
}

/**
 * Where to dig a chest niche into the wall beside `feet`: the block at feet
 * level and the one above it (a chest won't open with a solid block on top),
 * both natural stone or dirt, with solid ground under them and no water or
 * lava around them. The side walls of a tunnel come first (a wall with
 * another wall opposite), so the chest never ends up in the way ahead.
 * Returns the chest spot, or null.
 */
export function nicheSpot(feet: Vec3, blockAt: BlockAt, guarded: (p: Vec3) => boolean = isProtected): Vec3 | null {
  // Natural ground, and not a wall it keeps (its mine stairs, its shelter)
  const solidNatural = (p: Vec3): boolean => {
    const b = blockAt(p);
    return b !== null && b.boundingBox === "block" && isNatural(b.name) && !guarded(p);
  };
  const wet = (p: Vec3): boolean => [...HORIZONTAL, new Vec3(0, 1, 0)].some((d) => LIQUIDS.has(blockAt(p.plus(d))?.name ?? ""));
  const candidates = HORIZONTAL.filter((d) => {
    const spot = feet.plus(d);
    const above = spot.offset(0, 1, 0);
    return solidNatural(spot) && solidNatural(above) && isFloor(blockAt(spot.offset(0, -1, 0))) && !wet(spot) && !wet(above);
  });
  const sideWall = (d: Vec3): boolean => blockAt(feet.minus(d))?.boundingBox === "block";
  const best = candidates.find(sideWall) ?? candidates[0];
  return best ? feet.plus(best) : null;
}

/**
 * Places a chest where it isn't in the way. Underground (in a tunnel or a
 * cave) it digs a 2-high niche into the wall beside it and puts the chest in
 * the bottom of it, like a miner; in the open, on free ground nearby.
 */
export async function placeChestOutOfTheWay(itemName = "chest"): Promise<Block | null> {
  const placed = await placeOutOfTheWay(itemName);
  return placed ? markOwn(placed) : null;
}

/**
 * Puts a chest, a crafting table or a furnace where it isn't in the way
 * (owner: never in the middle of a tunnel, never down the stairs; aside,
 * at a tunnel's level, near the main tunnel). Underground it digs a niche
 * into a side wall; on its mine's stairs it goes to the nearest hub first
 * (the stairs' walls are kept). A chest's niche is two high (a chest won't
 * open under a block). In the open, free ground nearby.
 */
export async function placeOutOfTheWay(itemName: string): Promise<Block | null> {
  const blockAt = (p: Vec3): Block | null => bot.blockAt(p);
  // A furnace or a crafting table with its shelter near and that spot free:
  // in its shelter (owner: "why did he place the furnace outside instead of
  // the shelter?!"; cooking before the shelter was furnished put one on the
  // grass by the outdoor table)
  const home = await shelterSpotFor(itemName);
  if (home) return home;
  const tall = itemName.endsWith("chest");
  // Never where its mine's tunnels will start (they'd stop at it later)
  const { mineArmStarts } = await import("../skills/mine");
  const armStarts = new Set(mineArmStarts().map((p) => p.toString()));
  const guarded = (p: Vec3): boolean => isProtected(p) || armStarts.has(p.toString());
  const tryNiche = async (): Promise<Block | null> => {
    const feet = bot.entity.position.floored();
    if (!underRoof(feet, blockAt)) return null;
    const niche = nicheSpot(feet, blockAt, guarded);
    if (!niche) return null;
    console.log(`Digging a niche in the wall at ${niche} for the ${itemName}.`);
    const dug = (!tall || (await breakBlockAt(niche.x, niche.y + 1, niche.z))) && (await breakBlockAt(niche.x, niche.y, niche.z));
    if (dug && (await placeBlock(itemName, niche.x, niche.y, niche.z))) {
      const placed = bot.blockAt(niche);
      if (placed?.name === itemName) return placed;
    }
    console.log(`Placing the ${itemName} in the niche at ${niche} failed.`);
    return null;
  };
  const here = await tryNiche();
  if (here) return here;
  // In its mine with no wall to spare (the stairs): beside the nearest hub
  if (underRoof(bot.entity.position.floored(), blockAt)) {
    const { nearestMineHub } = await import("../skills/mine");
    const hub = nearestMineHub(bot.entity.position);
    if (hub && hub.distanceTo(bot.entity.position) < 48 && (await goTo(new pf.goals.GoalBlock(hub.x, hub.y, hub.z))).ok) {
      const atHub = await tryNiche();
      if (atHub) return atHub;
    }
  }
  console.log(`No wall to put the ${itemName} in here; free ground instead.`);
  return placeItemNear(itemName);
}

// How far from its shelter it still carries a furnace or table home to place it
const HOME_PLACE_RANGE = 64;

/** Places a furnace or crafting table in its shelter's own spot when that's free and near; null otherwise. */
async function shelterSpotFor(itemName: string): Promise<Block | null> {
  if (itemName !== "furnace" && itemName !== "crafting_table") return null;
  const { shelterSlots } = await import("./building");
  const slots = shelterSlots();
  const spot = itemName === "furnace" ? slots?.furnace : slots?.table;
  if (!slots || !spot) return null;
  const at = new Vec3(spot.x, spot.y, spot.z);
  const here = bot.entity.position;
  // Down its mine (well under its home): a niche there is fine
  if (here.distanceTo(at) > HOME_PLACE_RANGE || here.y < slots.stand.y - 6) return null;
  const now = bot.blockAt(at);
  if (!now || now.boundingBox !== "empty") return null; // something's there already
  const near = await goTo(new pf.goals.GoalNear(slots.stand.x, slots.stand.y, slots.stand.z, 1));
  if (!near.ok) return null;
  if (!(await placeBlock(itemName, at.x, at.y, at.z))) return null;
  const placed = bot.blockAt(at);
  if (placed?.name !== itemName) return null;
  console.log(`Put the ${itemName.replace(/_/g, " ")} in its spot in my shelter at ${at}.`);
  return placed;
}

/** A chest it just placed is its own (the planner takes only from its own chests). */
async function markOwn(chest: Block): Promise<Block> {
  const { rememberChest } = await import("../core/session");
  const p = chest.position;
  await rememberChest({ x: p.x, y: p.y, z: p.z, dimension: (bot.game as { dimension?: string }).dimension ?? "overworld", contents: {}, seenAt: Date.now(), own: true });
  return chest;
}

/** The nearest bed block within range, if any. */
export function findNearestBed(maxDistance = 24): Block | null {
  const bedIds = bot.registry.blocksArray.filter((b) => catalog().isBed(b.name)).map((b) => b.id);
  return bot.findBlock({ matching: bedIds, maxDistance });
}

// --- Placing next to something -------------------------------------------------

type BlockAt = (pos: Vec3) => Block | null;
const NEAR_RADIUS = 3; // how far from the target a spot may be

/** Air or a plant you can place over, with nothing solid in it. */
const isOpen = (b: Block | null): boolean => b !== null && b.boundingBox === "empty" && b.name !== "water" && b.name !== "lava";
/** Solid ground to stand an item on. */
const isFloor = (b: Block | null): boolean => b !== null && b.boundingBox === "block";

/**
 * Free spots right next to a target (a bed, a chest, the owner), closest
 * first: open space with solid ground under it, not on the target itself.
 * `size` 2 (a bed) also needs the next block east free.
 */
export function spotsNear(target: Vec3[], blockAt: BlockAt, size = 1, avoid: Vec3[] = []): Vec3[] {
  const center = target[0];
  const taken = (p: Vec3): boolean => [...target, ...avoid].some((t) => t.x === p.x && t.z === p.z && Math.abs(t.y - p.y) <= 1) || nearOwnPassage(p);
  const spots: { p: Vec3; d: number }[] = [];
  for (let dx = -NEAR_RADIUS; dx <= NEAR_RADIUS; dx++)
    for (let dz = -NEAR_RADIUS; dz <= NEAR_RADIUS; dz++)
      for (let dy = -1; dy <= 1; dy++) {
        const p = center.offset(dx, dy, dz);
        if (taken(p)) continue;
        const cells = size === 2 ? [p, p.offset(1, 0, 0)] : [p];
        if (cells.some((c) => taken(c) || !isOpen(blockAt(c)) || !isFloor(blockAt(c.offset(0, -1, 0))))) continue;
        // Distance to the nearest target block, so "next to the bed" means touching it when it can
        const d = Math.min(...target.map((t) => Math.hypot(t.x - p.x, t.z - p.z) + Math.abs(t.y - p.y) * 0.5));
        spots.push({ p, d });
      }
  return spots.sort((a, b) => a.d - b.d).map((s) => s.p);
}

/** What "near" names: the owner, or the nearest block of that kind (the bot's own bed first). */
export function findPlacementTarget(near: string): Vec3[] | null {
  const name = catalog().normalize(near);
  if (["owner", "me", "player", "here", "you"].includes(name)) {
    const owner = ownerEntity();
    return owner ? [owner.position.floored()] : null;
  }
  const matches = (blockName: string): boolean =>
    name === "bed" ? catalog().isBed(blockName) : blockName === name || blockName.endsWith(`_${name}`);
  if (name === "bed") {
    const own = loadBed();
    const b = own ? bot.blockAt(new Vec3(own.x, own.y, own.z)) : null;
    if (b && catalog().isBed(b.name)) return bedBlocks(b);
  }
  const ids = bot.registry.blocksArray.filter((b) => matches(b.name)).map((b) => b.id);
  const found = bot.findBlock({ matching: ids, maxDistance: 32 });
  if (!found) return null;
  return catalog().isBed(found.name) ? bedBlocks(found) : [found.position];
}

/** Both halves of a bed. */
function bedBlocks(bed: Block): Vec3[] {
  const other = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]
    .map((d) => bed.position.plus(d))
    .find((p) => catalog().isBed(bot.blockAt(p)?.name ?? ""));
  return other ? [bed.position, other] : [bed.position];
}

/**
 * Places an item right next to a target ("bed", "chest", "owner"...).
 * Returns the placed block, or a reason it couldn't.
 */
export async function placeItemNextTo(itemName: string, near: string): Promise<Block | string> {
  const target = findPlacementTarget(near);
  if (!target) return `I can't find the ${near.replace(/_/g, " ")} nearby.`;
  const t = target[0];
  const walked = await goTo(new pf.goals.GoalNear(t.x, t.y, t.z, 2));
  if (!walked.ok) return `I can't get to the ${near.replace(/_/g, " ")}: ${describeFailure(walked)}.`;
  const owner = ownerEntity();
  const avoid = owner ? [owner.position.floored()] : [];
  const size = footprint(itemName);
  let why = "there's no free spot next to it";
  for (const spot of spotsNear(target, (p) => bot.blockAt(p), size, avoid).slice(0, 3)) {
    if (size === 2) await faceAlong(spot, size); // the bed's head goes east, into the free block
    const placed = await placeBlockResult(itemName, spot.x, spot.y, spot.z);
    const block = bot.blockAt(spot);
    if (placed.ok && block?.name === itemName) return block;
    if (!placed.ok) {
      why = describeFailure(placed);
      if (wasStopped(placed)) break;
    }
    console.log(`Placing ${itemName} next to the ${near} at ${spot} failed: ${why}`);
  }
  return `I couldn't place it next to the ${near.replace(/_/g, " ")}: ${why}.`;
}
