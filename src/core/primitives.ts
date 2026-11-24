// Path: src/core/primitives.ts
// The checked game actions (Phase 3). Each one checks what it can before it
// starts (is that part of the world loaded, is it within reach, does the bot
// carry the item, does it have a tool), runs the game call with a time limit,
// the stop signal and the connection watched (core/guard), and then checks the
// world again: success means the server agreed. Actions in src/actions/ use
// these instead of calling bot.dig, bot.placeBlock, bot.equip... directly.

import type { Block } from "prismarine-block";
import type { Item } from "prismarine-item";
import type { Entity } from "prismarine-entity";
import type { Recipe } from "prismarine-recipe";
import type { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { bot } from "./body";
import { guarded } from "./guard";
import { paceClicks } from "./pace";
import { pathing, tools } from "./plugins";
import { placingOnPurpose } from "./scaffold";
import { markSelfAction } from "./events";
import { fail, ok, type ActionResult } from "./result";

type Goal = goals.Goal;
type Pos = { x: number; y: number; z: number };

/** How far the bot can touch a block (from its eyes to the block's middle). */
export const REACH = 4.5;
const DIG_TIMEOUT_MS = 15_000;
const PLACE_TIMEOUT_MS = 5_000;
const EQUIP_TIMEOUT_MS = 5_000;
const CONSUME_TIMEOUT_MS = 5_000;
const TOSS_TIMEOUT_MS = 3_000;
const CRAFT_TIMEOUT_MS = 10_000; // mineflayer waits for the crafting window with no limit
const USE_TIMEOUT_MS = 5_000;
const CONFIRM_MS = 1_000; // how long the server gets to show the change

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const floor = (p: Pos): Vec3 => new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
const eyes = (): Vec3 => bot.entity.position.offset(0, bot.entity.height ?? 1.62, 0);
const middle = (p: Pos): Vec3 => new Vec3(p.x + 0.5, p.y + 0.5, p.z + 0.5);

/** Waits until `check` is true, up to `ms`. */
async function until(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(50);
  }
  return check();
}

// --- Reading the world: unknown is unknown -------------------------------------

/**
 * The block at a spot, or null when that part of the world isn't loaded.
 * Null means "unknown", never "air": callers must not walk, dig or build on it.
 */
export function knownBlock(pos: Pos): Block | null {
  return bot.blockAt(floor(pos)) ?? null;
}

/** True when the spot is loaded and empty (air, a plant, water or lava): something can be placed there. */
export function isReplaceable(block: Block | null): boolean {
  return block !== null && block.boundingBox === "empty";
}

/** True when the bot can touch the block at `pos` from where it stands. */
export function withinReach(pos: Pos, reach = REACH): boolean {
  return eyes().distanceTo(middle(floor(pos))) <= reach;
}

// --- Walking -----------------------------------------------------------------

/** A time limit for a walk: generous for the distance, never endless. */
function walkTimeout(goal: Goal): number {
  const g = goal as unknown as Partial<Pos>;
  if (typeof g.x !== "number" || typeof g.z !== "number") return 60_000;
  const distance = Math.hypot(g.x - bot.entity.position.x, g.z - bot.entity.position.z);
  return Math.min(300_000, Math.max(30_000, 20_000 + distance * 1_500));
}

/**
 * Walks to a goal and checks it really got there. Unreachable goals, a stop,
 * a time limit or a dropped connection end it with the matching reason.
 */
export async function goTo(goal: Goal, options: { timeoutMs?: number } = {}): Promise<ActionResult> {
  const walked = await guarded("walking", () => pathing.goto(goal), {
    timeoutMs: options.timeoutMs ?? walkTimeout(goal),
    onStop: () => pathing.stop(),
  });
  if (!walked.ok) return walked;
  if (!bot.entity) return fail("disconnected", "no body after walking");
  if (!goal.isEnd(bot.entity.position.floored() as never)) return fail("unreachable", "stopped short of the goal");
  return ok();
}

// --- Breaking blocks ------------------------------------------------------------

export type BreakOptions = {
  /** Break it even if the drop is lost (leaves, or clearing the way). Default: a tool that harvests it is required. */
  allowWithoutHarvest?: boolean;
};

/**
 * Breaks the block at `pos` with the best tool it carries, and checks it is
 * really gone. The bot must already be within reach. Air, water and lava are
 * "nothing to break" (ok, with `alreadyGone`).
 */
export async function breakBlock(pos: Pos, options: BreakOptions = {}): Promise<ActionResult<{ name: string; alreadyGone: boolean }>> {
  const at = floor(pos);
  const block = knownBlock(at);
  if (!block) return fail("unknown_block", `${at} isn't loaded`);
  if (block.name === "air" || block.name === "cave_air" || block.name === "water" || block.name === "lava") {
    return ok({ name: block.name, alreadyGone: true });
  }
  if (!withinReach(at)) return fail("out_of_reach", `${block.name} at ${at}`);
  if (bot.game.gameMode !== "creative") {
    await tools.equipForBlock(block);
    const held = bot.heldItem ? bot.heldItem.type : null;
    if (!options.allowWithoutHarvest && !block.canHarvest(held)) return fail("no_tool", `nothing I carry harvests ${block.name}`);
  }
  if (!bot.canDigBlock(block)) return fail("refused", `${block.name} can't be broken`);
  const before = block.stateId;
  markSelfAction(at);
  const dug = await guarded(`digging ${block.name}`, () => bot.dig(block, true), {
    timeoutMs: DIG_TIMEOUT_MS,
    onStop: () => bot.stopDigging(),
  });
  if (!dug.ok) return dug;
  // The server must agree: a protected area puts the block straight back
  const gone = await until(() => knownBlock(at)?.stateId !== before, CONFIRM_MS);
  if (!gone) return fail("refused", `${block.name} at ${at} came back`);
  return ok({ name: block.name, alreadyGone: false });
}

// --- Placing blocks -------------------------------------------------------------

const FACES = [new Vec3(0, -1, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0)];

/** A solid block next to `at` to place against, bottom first (or the side asked for). */
function supportFor(at: Vec3, prefer?: Vec3): { reference: Block; face: Vec3 } | null {
  const order = prefer ? [prefer, ...FACES.filter((f) => !f.equals(prefer))] : FACES;
  for (const d of order) {
    const reference = knownBlock(at.plus(d));
    if (reference && reference.boundingBox === "block") return { reference, face: d.scaled(-1) };
  }
  return null;
}

/** True when the bot's own body is in that block (a full block can't go there). */
function standingIn(at: Vec3): boolean {
  const feet = bot.entity.position.floored();
  return at.x === feet.x && at.z === feet.z && (at.y === feet.y || at.y === feet.y + 1);
}

export type PlaceOptions = {
  /** Place against the block on this side of the spot (e.g. (0,-1,0): on the floor). */
  against?: Vec3;
};

/**
 * Places the exact item `itemName` at `pos` and checks the block is there.
 * The spot must be free, the bot within reach, and something solid next to
 * it. A server that refuses (a protected area) gives "refused".
 */
export async function placeBlockAt(itemName: string, pos: Pos, options: PlaceOptions = {}): Promise<ActionResult<{ name: string }>> {
  const at = floor(pos);
  const item = bot.inventory.items().find((i) => i.name === itemName);
  if (!item) return fail("missing_items", `no ${itemName} to place`);
  const target = knownBlock(at);
  if (!target) return fail("unknown_block", `${at} isn't loaded`);
  if (!isReplaceable(target)) return fail("occupied", `${target.name} at ${at}`);
  const support = supportFor(at, options.against);
  if (!support) return fail("no_support", `nothing solid next to ${at}`);
  if (!withinReach(support.reference.position)) return fail("out_of_reach", `${at}`);
  // Torches, rails and the like can go where the bot stands; solid blocks can't
  if (standingIn(at) && bot.registry.blocksByName[itemName]?.boundingBox !== "empty") return fail("occupied", "I'm standing there");
  const equipped = await equipItem(itemName, "hand");
  if (!equipped.ok) return equipped;
  await guarded("looking", () => bot.lookAt(middle(support.reference.position), true), { timeoutMs: 2_000 });
  const before = target.stateId;
  markSelfAction(at);
  const placed = await guarded(`placing ${itemName}`, () => placingOnPurpose(() => bot.placeBlock(support.reference, support.face)), {
    timeoutMs: PLACE_TIMEOUT_MS,
  });
  // mineflayer throws when the server's answer doesn't show the block; check the world either way
  const now = await until(() => {
    const b = knownBlock(at);
    // Torches, rails and flowers have no collision box, so "changed and not air" is the test
    return b !== null && b.stateId !== before && b.name !== "air" && b.name !== "cave_air";
  }, placed.ok ? CONFIRM_MS : 300);
  if (now) return ok({ name: knownBlock(at)!.name });
  if (!placed.ok && placed.reason !== "error") return placed;
  return fail("refused", `${itemName} at ${at} didn't stay`);
}

// --- Hands and inventory ---------------------------------------------------------

export type EquipSlot = "hand" | "off-hand" | "head" | "torso" | "legs" | "feet";

/** The item in an equipment slot right now. */
function equippedIn(slot: EquipSlot): Item | null {
  if (slot === "hand") return bot.heldItem ?? null;
  return bot.inventory.slots[bot.getEquipmentDestSlot(slot)] ?? null;
}

/** Puts the exact item `itemName` in a hand or armor slot and checks it's there. */
export async function equipItem(itemName: string, slot: EquipSlot = "hand"): Promise<ActionResult> {
  if (equippedIn(slot)?.name === itemName) return ok();
  const item = bot.inventory.items().find((i) => i.name === itemName);
  if (!item) return fail("missing_items", `no ${itemName}`);
  const done = await guarded(`equipping ${itemName}`, () => bot.equip(item, slot), { timeoutMs: EQUIP_TIMEOUT_MS });
  if (!done.ok) return done;
  if (!(await until(() => equippedIn(slot)?.name === itemName, CONFIRM_MS))) return fail("refused", `${itemName} isn't in my ${slot}`);
  return ok();
}

/** Takes off what's in an equipment slot. */
export async function unequipSlot(slot: EquipSlot): Promise<ActionResult> {
  if (!equippedIn(slot)) return ok();
  if (bot.inventory.emptySlotCount() === 0) return fail("full", "no room to take it off");
  const done = await guarded(`taking off ${slot}`, () => bot.unequip(slot), { timeoutMs: EQUIP_TIMEOUT_MS });
  if (!done.ok) return done;
  if (!(await until(() => !equippedIn(slot), CONFIRM_MS))) return fail("refused", `${slot} is still on`);
  return ok();
}

/** How many of an exact item the bot carries. */
export function carried(itemName: string): number {
  return bot.inventory.items().filter((i) => i.name === itemName).reduce((n, i) => n + i.count, 0);
}

/** Eats or drinks the exact item `itemName` and checks one is gone. */
export async function consumeItem(itemName: string): Promise<ActionResult> {
  const before = carried(itemName);
  if (before === 0) return fail("missing_items", `no ${itemName}`);
  const equipped = await equipItem(itemName, "hand");
  if (!equipped.ok) return equipped;
  const done = await guarded(`eating ${itemName}`, () => bot.consume(), {
    timeoutMs: CONSUME_TIMEOUT_MS,
    onStop: () => bot.deactivateItem(),
  });
  if (!done.ok) return done;
  if (!(await until(() => carried(itemName) < before, CONFIRM_MS))) return fail("refused", `still have the ${itemName}`);
  return ok();
}

/** Throws `count` of the exact item stack `item` on the ground in front, and checks they left. */
export async function tossStack(item: Item, count: number): Promise<ActionResult<number>> {
  const before = carried(item.name);
  const n = Math.min(count, item.count);
  const done = await guarded(`throwing ${item.name}`, () => bot.toss(item.type, null, n), { timeoutMs: TOSS_TIMEOUT_MS });
  if (!done.ok) return done;
  if (!(await until(() => carried(item.name) <= before - n, CONFIRM_MS))) return fail("refused", `the ${item.name} came back`);
  return ok(n);
}

// --- Using blocks and looking -------------------------------------------------------

/** Looks at a point (turns the head). */
export async function lookAt(point: Pos): Promise<ActionResult> {
  return guarded("looking", () => bot.lookAt(new Vec3(point.x, point.y, point.z), true), { timeoutMs: 2_000 });
}

/** Right-clicks a block within reach (a lever, a door, a bed, a farmland with seeds in hand). */
export async function useBlock(block: Block): Promise<ActionResult> {
  if (!withinReach(block.position)) return fail("out_of_reach", `${block.name} at ${block.position}`);
  return guarded(`using ${block.name}`, () => bot.activateBlock(block), { timeoutMs: USE_TIMEOUT_MS });
}

// --- Crafting --------------------------------------------------------------------

/**
 * Runs `recipe` `times` times (at `table`, or in the inventory grid) and
 * checks the result appeared. mineflayer waits for the crafting window with
 * no time limit; this gives up and closes the window instead.
 */
export async function craftWith(recipe: Recipe, times: number, table: Block | null): Promise<ActionResult<number>> {
  const resultId = recipe.result.id;
  const resultName = bot.registry.items[resultId]?.name ?? String(resultId);
  if (table && !withinReach(table.position)) return fail("out_of_reach", `crafting table at ${table.position}`);
  const before = carried(resultName);
  await paceClicks(); // a craft is several window clicks
  const done = await guarded(`crafting ${resultName}`, () => bot.craft(recipe, times, table ?? undefined), {
    timeoutMs: CRAFT_TIMEOUT_MS * Math.max(1, Math.ceil(times / 8)),
    onStop: () => {
      if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
    },
  });
  if (!done.ok) return done;
  const expected = (recipe.result.count ?? 1) * times;
  if (!(await until(() => carried(resultName) >= before + expected, CONFIRM_MS))) {
    const made = carried(resultName) - before;
    if (made <= 0) return fail("refused", `no ${resultName} appeared`);
    return ok(made); // made fewer than asked (e.g. a stack was full): say how many
  }
  return ok(carried(resultName) - before);
}

// --- Beds ------------------------------------------------------------------------

/**
 * Lies down in a bed within reach and checks it's really asleep. The server's
 * reason when it can't (not night, monsters nearby, occupied) is the detail.
 */
export async function sleepIn(bed: Block): Promise<ActionResult> {
  if (!withinReach(bed.position)) return fail("out_of_reach", `bed at ${bed.position}`);
  const done = await guarded("going to bed", () => bot.sleep(bed), { timeoutMs: USE_TIMEOUT_MS });
  if (!done.ok) return done;
  if (!(await until(() => bot.isSleeping, CONFIRM_MS))) return fail("refused", "not asleep");
  return ok();
}

// --- Riding and using things ---------------------------------------------------------

/** Gets on a boat, minecart or animal and checks it's riding. */
export async function mountEntity(entity: Entity): Promise<ActionResult> {
  if (bot.vehicle === entity) return ok();
  if (entity.position.distanceTo(bot.entity.position) > REACH + 1) return fail("out_of_reach", `${entity.name ?? "vehicle"} is too far`);
  const done = await guarded(`getting on the ${entity.name ?? "vehicle"}`, async () => bot.mount(entity), { timeoutMs: USE_TIMEOUT_MS });
  if (!done.ok) return done;
  if (!(await until(() => Boolean(bot.vehicle), 2_000))) return fail("refused", `couldn't get on the ${entity.name ?? "vehicle"}`);
  return ok();
}

/** Gets off whatever it rides and checks it's off. */
export async function dismountVehicle(): Promise<ActionResult> {
  if (!bot.vehicle) return ok();
  const done = await guarded("getting off", async () => bot.dismount(), { timeoutMs: USE_TIMEOUT_MS });
  if (!done.ok) return done;
  if (!(await until(() => !bot.vehicle, 3_000))) return fail("refused", "still riding");
  return ok();
}

/** Right-clicks with the held item (place a boat, a minecart; raise a shield with `offHand`). */
export function useHeldItem(offHand = false): void {
  bot.activateItem(offHand);
}

/** Right-clicks an entity (saddle a horse, push a boat). */
export async function useEntity(entity: Entity): Promise<ActionResult> {
  if (entity.position.distanceTo(bot.entity.position) > REACH + 1) return fail("out_of_reach", `${entity.name ?? "entity"} is too far`);
  return guarded(`using the ${entity.name ?? "entity"}`, () => bot.activateEntity(entity), { timeoutMs: USE_TIMEOUT_MS });
}

/** Hits an entity once (breaking a boat to pick it up). */
export function hitEntity(entity: Entity): void {
  bot.attack(entity);
}

/** Holds or lets go of a movement key (sneak, jump, forward...). */
export function setControl(control: "forward" | "back" | "left" | "right" | "jump" | "sprint" | "sneak", on: boolean): void {
  bot.setControlState(control, on);
}
