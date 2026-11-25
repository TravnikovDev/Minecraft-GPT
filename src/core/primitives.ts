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
import { isAnyReflexActive } from "./reflexes";
import { placeKey, recentFailure } from "./failures";
import { forbiddenAt, noteRevert } from "./forbidden";
import { beginUse, takeoverCount, waitTurn, type Resource } from "./leases";
import { currentSignal } from "./commandContext";
import { placingOnPurpose } from "./scaffold";
import { markSelfAction } from "./events";
import { fail, ok, type ActionResult } from "./result";

type Goal = goals.Goal;
type Pos = { x: number; y: number; z: number };

/** How far the bot can touch a block (from its eyes to the block's middle). */
export const REACH = 4.5;
// Blocks that fall: a new one dropping into the gap isn't the server putting it back
const FALLING = new Set(["sand", "red_sand", "gravel", "suspicious_sand", "suspicious_gravel", "anvil", "chipped_anvil", "damaged_anvil", "pointed_dripstone", "scaffolding"]);
const DIG_SLACK_MS = 3_000; // on top of the dig's own time (bot.digTime), which already counts water and air
const PLACE_TIMEOUT_MS = 5_000;
const EQUIP_TIMEOUT_MS = 5_000;
const CONSUME_TIMEOUT_MS = 5_000;
const TOSS_TIMEOUT_MS = 3_000;
// mineflayer gives up waiting for a crafting table's window after 20 s; waiting
// longer than that lets its own timeout fire first, so no stale wait is left
// to grab the next window that opens (a chest)
const CRAFT_TIMEOUT_MS = 25_000;
const CRAFT_BATCH = 8; // recipe runs per craft call (each run is several window clicks)
const USE_TIMEOUT_MS = 5_000;
const CONFIRM_MS = 1_000; // how long the server gets to show the change
const WALK_NO_PROGRESS_MS = 20_000; // a walk that gets no closer for this long has given up

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

/** The server's round trip, for how long to wait before trusting what the world shows. */
function settleMs(): number {
  const ping = (bot.player as { ping?: number } | undefined)?.ping ?? 100;
  return Math.max(100, 2 * ping + 50);
}

/** True when the bot stands at the goal, as the pathfinder itself judges it (a slab, farmland or a chest is fine). */
function atGoal(goal: Goal): boolean {
  const feet = bot.entity.position.floored();
  return goal.isEnd(feet as never) || goal.isEnd(feet.offset(0, 1, 0) as never);
}

/**
 * Watches a walk: gives up when the bot gets no closer for a while (not
 * counting time a reflex holds it: running from a creeper, a fight).
 */
function walkWatchdog(explain: () => string = () => ""): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  let last = bot.entity.position.clone();
  let lastProgress = Date.now();
  const timer = setInterval(() => {
    if (!bot.entity) return;
    const here = bot.entity.position;
    if (here.distanceTo(last) > 0.5 || isAnyReflexActive()) {
      last = here.clone();
      lastProgress = Date.now();
    } else if (Date.now() - lastProgress > WALK_NO_PROGRESS_MS) {
      // What it was doing, so a stall in a game test can be explained from the log
      console.log(`Walk stalled at ${here.floored()}: ${explain()}`);
      controller.abort(`no progress for ${WALK_NO_PROGRESS_MS / 1000}s`);
    }
  }, 1_000);
  return { signal: controller.signal, stop: () => clearInterval(timer) };
}

/**
 * Walks to a goal and checks it really got there. Unreachable goals, a stop,
 * no progress for a while, a time limit or a dropped connection end it with
 * the matching reason. A goal changed by something else is "interrupted".
 */
// Where the last walk was headed (the stuck watcher remembers it when giving up)
let lastGoal: Pos | null = null;

/** The spot the last walk was headed for, if its goal has one. */
export function lastWalkGoal(): Pos | null {
  return lastGoal;
}

export async function goTo(goal: Goal, options: { timeoutMs?: number } = {}): Promise<ActionResult> {
  const g = goal as unknown as Partial<Pos>;
  const spot = typeof g.x === "number" && typeof g.y === "number" && typeof g.z === "number" ? { x: g.x, y: g.y, z: g.z } : null;
  if (spot) {
    // Got stuck going there a little while ago: don't walk into the same dead end
    const failed = recentFailure(placeKey(spot));
    if (failed) return fail("unreachable", `${failed} a little while ago`);
    lastGoal = spot;
  }
  // The pathfinder's last word on this walk (a path, no path, a timeout)
  let lastPath = "no path computed yet";
  const onPath = (r: { status: string; path: unknown[] }): void => {
    lastPath = `${r.status}, ${r.path.length} moves`;
  };
  bot.on?.("path_update" as never, onPath as never);
  const block = (dy: number): string => bot.blockAt(bot.entity.position.floored().offset(0, dy, 0))?.name ?? "?";
  const watchdog = walkWatchdog(
    () =>
      `goal ${spot ? `${spot.x}, ${spot.y}, ${spot.z}` : goal.constructor.name}; path ${lastPath}; ` +
      `moving ${bot.pathfinder?.isMoving() ?? "?"}, mining ${bot.pathfinder?.isMining() ?? "?"}, building ${bot.pathfinder?.isBuilding() ?? "?"}; ` +
      `below ${block(-1)}, feet ${block(0)}, head ${block(1)}`
  );
  try {
    const walked = await guarded("walking", (signal) => pathing.goto(goal, signal), {
      timeoutMs: options.timeoutMs ?? 10 * 60_000, // the watchdog ends stuck walks long before this
      watchdog: watchdog.signal,
      onStop: () => pathing.stopIf(goal), // never clear a reflex's goal or a paused follow
    });
    if (!walked.ok) return walked;
  } finally {
    watchdog.stop();
    bot.removeListener?.("path_update" as never, onPath as never);
    // Only a walk in progress can be blamed for being stuck (not one that ended, at a chest or a table)
    if (spot && lastGoal === spot) lastGoal = null;
  }
  if (!bot.entity) return fail("disconnected", "no body after walking");
  if (!atGoal(goal)) return fail("unreachable", "stopped short of the goal");
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
async function breakBlockNow(pos: Pos, options: BreakOptions = {}): Promise<ActionResult<{ name: string; alreadyGone: boolean }>> {
  const at = floor(pos);
  const block = knownBlock(at);
  if (!block) return fail("unknown_block", `${at} isn't loaded`);
  if (block.name === "air" || block.name === "cave_air" || block.name === "water" || block.name === "lava") {
    return ok({ name: block.name, alreadyGone: true });
  }
  const keepOut = forbiddenAt(at);
  if (keepOut) return fail("forbidden", keepOut.reason);
  if (!withinReach(at)) return fail("out_of_reach", `${block.name} at ${at}`);
  if (bot.game.gameMode !== "creative") {
    const tool = await guarded("taking a tool", () => tools.equipForBlock(block), { timeoutMs: CONFIRM_MS * 5 });
    if (!tool.ok && tool.reason !== "error") return tool;
    const held = bot.heldItem ? bot.heldItem.type : null;
    if (!options.allowWithoutHarvest && !block.canHarvest(held)) return fail("no_tool", `nothing I carry harvests ${block.name}`);
  }
  if (!bot.canDigBlock(block)) return fail("refused", `${block.name} can't be broken`);
  const before = block.stateId;
  markSelfAction(at);
  const dug = await guarded(`digging ${block.name}`, () => bot.dig(block, true), {
    timeoutMs: bot.digTime(block) * 1.5 + DIG_SLACK_MS,
    onStop: () => bot.stopDigging(),
  });
  if (!dug.ok) return dug;
  // mineflayer writes air into its own world copy the moment the dig ends;
  // the server's answer comes a round trip later, and a protected area puts
  // the block back then. Only the state after that counts.
  await sleep(settleMs());
  if (knownBlock(at)?.stateId === before) {
    // Sand or gravel from above falls into the gap: that's not the server
    if (FALLING.has(block.name) || block.name.endsWith("_concrete_powder")) return ok({ name: block.name, alreadyGone: false });
    await noteRevert(at); // twice close together: a protected area
    return fail("reverted", `${block.name} at ${at} came back`);
  }
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
async function placeBlockAtNow(itemName: string, pos: Pos, options: PlaceOptions = {}): Promise<ActionResult<{ name: string }>> {
  const at = floor(pos);
  const item = bot.inventory.items().find((i) => i.name === itemName);
  if (!item) return fail("missing_items", `no ${itemName} to place`);
  const target = knownBlock(at);
  if (!target) return fail("unknown_block", `${at} isn't loaded`);
  const keepOut = forbiddenAt(at);
  if (keepOut) return fail("forbidden", keepOut.reason);
  if (!isReplaceable(target)) return fail("occupied", `${target.name} at ${at}`);
  const support = supportFor(at, options.against);
  if (!support) return fail("no_support", `nothing solid next to ${at}`);
  if (!withinReach(support.reference.position)) return fail("out_of_reach", `${at}`);
  // A solid block can't go where the bot stands; torches, rails, seeds and the
  // like can (an item that isn't a block by the same name is never solid here)
  if (standingIn(at) && bot.registry.blocksByName[itemName]?.boundingBox === "block") return fail("occupied", "I'm standing there");
  const equipped = await equipItem(itemName, "hand");
  if (!equipped.ok) return equipped;
  await guarded("looking", () => bot.lookAt(middle(support.reference.position), true), { timeoutMs: 2_000 });
  const before = target.stateId;
  markSelfAction(at);
  const placed = await guarded(`placing ${itemName}`, () => placingOnPurpose(() => bot.placeBlock(support.reference, support.face)), {
    timeoutMs: PLACE_TIMEOUT_MS,
  });
  // mineflayer throws when the server's answer doesn't show the block; check the world either way
  // Torches, rails and flowers have no collision box, so "a different block,
  // not air" is the test (water rising or falling there doesn't count)
  const changed = (): boolean => {
    const b = knownBlock(at);
    return b !== null && b.stateId !== before && b.name !== target.name && b.name !== "air" && b.name !== "cave_air";
  };
  await until(changed, placed.ok ? CONFIRM_MS : 300);
  if (changed()) await sleep(settleMs()); // the server may still take it back
  const now = changed();
  if (now) return ok({ name: knownBlock(at)!.name });
  if (!placed.ok && placed.reason !== "error" && placed.reason !== "refused") return placed;
  // Only the server undoing it counts toward a protected area (not a mob standing in the spot)
  const inTheWay = Object.values(bot.entities).some((e) => e !== bot.entity && e.position.floored().equals(at));
  if (!inTheWay) await noteRevert(at); // twice close together: a protected area
  return fail(inTheWay ? "occupied" : "reverted", inTheWay ? `something is standing at ${at}` : `${itemName} at ${at} didn't stay`);
}

// --- Hands and inventory ---------------------------------------------------------

export type EquipSlot = "hand" | "off-hand" | "head" | "torso" | "legs" | "feet";

/** The item in an equipment slot right now. */
function equippedIn(slot: EquipSlot): Item | null {
  if (slot === "hand") return bot.heldItem ?? null;
  return bot.inventory.slots[bot.getEquipmentDestSlot(slot)] ?? null;
}

/** Puts the exact item `itemName` in a hand or armor slot and checks it's there. */
async function equipItemNow(itemName: string, slot: EquipSlot = "hand"): Promise<ActionResult> {
  if (equippedIn(slot)?.name === itemName) return ok();
  const item = bot.inventory.items().find((i) => i.name === itemName);
  if (!item) return fail("missing_items", `no ${itemName}`);
  const done = await guarded(`equipping ${itemName}`, () => bot.equip(item, slot), { timeoutMs: EQUIP_TIMEOUT_MS });
  if (!done.ok) return done;
  if (!(await until(() => equippedIn(slot)?.name === itemName, CONFIRM_MS))) return fail("refused", `${itemName} isn't in my ${slot}`);
  return ok();
}

/** Takes off what's in an equipment slot. */
async function unequipSlotNow(slot: EquipSlot): Promise<ActionResult> {
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
async function consumeItemNow(itemName: string): Promise<ActionResult> {
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
async function tossStackNow(item: Item, count: number): Promise<ActionResult<number>> {
  const before = carried(item.name);
  const n = Math.min(count, item.count);
  const done = await guarded(`throwing ${item.name}`, () => bot.toss(item.type, null, n), { timeoutMs: TOSS_TIMEOUT_MS });
  if (!done.ok) return done;
  // A toss is window clicks mineflayer applies to its own copy right away;
  // ask the server for the real inventory before counting
  await syncInventory();
  if (!(await until(() => carried(item.name) <= before - n, CONFIRM_MS))) return fail("refused", `the ${item.name} came back`);
  return ok(n);
}

/**
 * Asks the server for the true contents of a window (the inventory by
 * default). On 1.17.1+ mineflayer applies clicks to its own copy and the
 * server stays silent about clicks it ignored; this makes it answer.
 */
export async function syncInventory(window: unknown = bot.inventory): Promise<void> {
  const sync = (bot as unknown as { _syncWindow?: (w: unknown) => Promise<void> })._syncWindow;
  if (!sync) return;
  await guarded("checking the inventory", () => sync(window), { timeoutMs: 2_000 });
}

/** Lets go of the item being used (lowers a shield, stops eating, after placing a boat). */
export function stopUsingItem(): void {
  bot.deactivateItem();
}

/** Creative mode only: puts an item straight into a hotbar slot. */
export async function giveCreativeItem(slot: number, item: Item): Promise<ActionResult> {
  return guarded("taking it from the creative menu", () => bot.creative.setInventorySlot(slot, item), { timeoutMs: USE_TIMEOUT_MS });
}

// --- Using blocks and looking -------------------------------------------------------

/** Looks at a point (turns the head). */
export async function lookAt(point: Pos): Promise<ActionResult> {
  return guarded("looking", () => bot.lookAt(new Vec3(point.x, point.y, point.z), true), { timeoutMs: 2_000 });
}

/** Right-clicks a block within reach (a lever, a door, a bed, a farmland with seeds in hand). */
async function useBlockNow(block: Block): Promise<ActionResult> {
  if (!withinReach(block.position)) return fail("out_of_reach", `${block.name} at ${block.position}`);
  return guarded(`using ${block.name}`, () => bot.activateBlock(block), { timeoutMs: USE_TIMEOUT_MS });
}

// --- Crafting --------------------------------------------------------------------

/**
 * Runs `recipe` `times` times (at `table`, or in the inventory grid) and
 * checks the result appeared. mineflayer waits for the crafting window with
 * no time limit; this gives up and closes the window instead.
 */
async function craftWithNow(recipe: Recipe, times: number, table: Block | null): Promise<ActionResult<number>> {
  const resultId = recipe.result.id;
  const resultName = bot.registry.items[resultId]?.name ?? String(resultId);
  if (table && !withinReach(table.position)) return fail("out_of_reach", `crafting table at ${table.position}`);
  const before = carried(resultName);
  // In batches: each recipe run is several window clicks, and servers kick
  // players who click too fast
  for (let left = times; left > 0; left -= CRAFT_BATCH) {
    const batch = Math.min(CRAFT_BATCH, left);
    await paceClicks();
    const done = await guarded(`crafting ${resultName}`, () => bot.craft(recipe, batch, table ?? undefined), {
      timeoutMs: CRAFT_TIMEOUT_MS,
      onStop: () => {
        if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
      },
    });
    if (!done.ok) {
      const made = carried(resultName) - before;
      return made > 0 && !(done.reason === "aborted" || done.reason === "disconnected") ? ok(made) : done;
    }
  }
  // mineflayer resyncs the window after crafting, so the inventory is the server's
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
  // "it's not night", "monsters nearby", "occupied": the server's answer is the detail
  if (!done.ok) return done.reason === "error" ? fail("refused", done.detail) : done;
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

/** Turns to a direction (yaw, pitch in radians). */
export async function lookToward(yaw: number, pitch: number): Promise<ActionResult> {
  return guarded("turning", () => bot.look(yaw, pitch, true), { timeoutMs: 2_000 });
}

// --- Taking turns with reflexes (core/leases) --------------------------------------

/**
 * Runs a hands/window action when it's this code's turn: waits while a reflex
 * (or a borrower, eating) has the resource, marks it in use so borrowers wait
 * for it to finish, and if a reflex cut in mid-way (a creeper: the dig was
 * stopped), waits for it to let go and tries again (up to 3 times).
 */
async function using<T>(resources: Resource[], act: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const signal = currentSignal();
  let result: ActionResult<T> = fail("interrupted", "never ran");
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const r of resources) {
      if (!(await waitTurn(r, () => Boolean(signal?.aborted)))) return fail("aborted", "stopped while waiting for my turn");
    }
    const before = resources.map((r) => takeoverCount(r));
    const ends = resources.map((r) => beginUse(r));
    try {
      result = await act();
    } finally {
      for (const end of ends) end();
    }
    const cutIn = resources.some((r, i) => takeoverCount(r) !== before[i]);
    if (result.ok || !cutIn || signal?.aborted) return result;
    console.log(`A reflex cut in (${result.reason}); trying again once it's done.`);
  }
  return result;
}

/** breakBlock, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function breakBlock(pos: Pos, options: BreakOptions = {}): Promise<ActionResult<{ name: string; alreadyGone: boolean }>> {
  return using(["hands"], () => breakBlockNow(pos, options));
}

/** placeBlockAt, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function placeBlockAt(itemName: string, pos: Pos, options: PlaceOptions = {}): Promise<ActionResult<{ name: string }>> {
  return using(["hands"], () => placeBlockAtNow(itemName, pos, options));
}

/** equipItem, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function equipItem(itemName: string, slot: EquipSlot = "hand"): Promise<ActionResult> {
  return using(["hands"], () => equipItemNow(itemName, slot));
}

/** unequipSlot, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function unequipSlot(slot: EquipSlot): Promise<ActionResult> {
  return using(["hands"], () => unequipSlotNow(slot));
}

/** consumeItem, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function consumeItem(itemName: string): Promise<ActionResult> {
  return using(["hands"], () => consumeItemNow(itemName));
}

/** tossStack, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function tossStack(item: Item, count: number): Promise<ActionResult<number>> {
  return using(["hands"], () => tossStackNow(item, count));
}

/** useBlock, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function useBlock(block: Block): Promise<ActionResult> {
  return using(["hands"], () => useBlockNow(block));
}

/** craftWith, waiting its turn while a reflex or a borrower has the body (core/leases). */
export function craftWith(recipe: Recipe, times: number, table: Block | null): Promise<ActionResult<number>> {
  return using(["hands", "window"], () => craftWithNow(recipe, times, table));
}
