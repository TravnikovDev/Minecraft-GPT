// Path: src/actions/pickup.ts
// Picking up items from the ground, like a player: walk to each one, wait
// until the game hands it over, then go to the next. Also tidies up items it
// can see while it has nothing else to do (saplings and apples from decaying
// leaves, drops it missed), and never grabs back what it threw away itself.
//
// Why the old pickup missed most drops (36 of 44 pickups in one session got
// nothing): it only looked at items lying still, but fresh drops are still
// flying; and it gave up when an item was still there after it walked over,
// but the game won't let anyone pick up a fresh drop for its first half second.

import type { Entity } from "prismarine-entity";
import type { Bot } from "mineflayer";
import pf from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { pathing } from "../core/plugins";
import { goTo } from "../core/primitives";
import { describeFailure, wasStopped } from "../core/result";
import { isCommandCancelled, getCurrentCommandName, markOwnWork } from "../core/commandContext";
import { isAnyReflexActive } from "../core/reflexes";
import { areChoresMuted, inChore, isChoreRunning, runChore } from "../core/chores";
import { canSeePoint, type SightWorld } from "./sight";
import { ownerEntity } from "../managers/ownerDialog";

const PICKUP_WAIT_MS = 1500; // after arriving: the half-second pickup delay, plus slack
const SETTLE_MS = 600; // fresh drops fly before they land
const MAX_TRIES_PER_ITEM = 2;
const MAX_ITEMS = 40;
const IDLE_RADIUS = 12;


// Items the bot threw itself (discard, give): never picked back up
const tossedByMe = new WeakSet<Entity>();
let tossCount = 0;
// Items it set down only to make room for a moment (crafting a chest): picked up again afterwards
const setDownForLater = new WeakSet<Entity>();

/** Items it set down to make room, still lying there. */
export function itemsSetDownForLater(): Entity[] {
  return Object.values(bot.entities).filter((e) => setDownForLater.has(e));
}
// Items it couldn't walk to: left alone for a while (the idle tidy runs every few seconds)
const UNREACHABLE_MS = 60_000;
const unreachableUntil = new WeakMap<Entity, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A dropped item entity. */
export const isDroppedItem = (e: Entity): boolean => e.name === "item";

/**
 * Runs a toss (discard, give) and marks the item entities it throws, so no
 * pickup ever grabs them back.
 */
export async function tossing<T>(toss: () => Promise<T>, { pickUpLater = false } = {}): Promise<T> {
  // Each toss listens for its item for a second; when two tosses overlap
  // (junk thrown away, then a stack set down for later), the newest one owns
  // what spawns, so the stack isn't taken for junk
  const mine = ++tossCount;
  const onSpawn = (e: Entity): void => {
    if (mine !== tossCount) return;
    if (!isDroppedItem(e) || e.position.distanceTo(bot.entity.position) >= 3) return;
    if (pickUpLater) setDownForLater.add(e);
    else tossedByMe.add(e);
  };
  // The listener goes off the same connection it went on (a reconnect swaps the bot)
  const current = bot;
  current.on("entitySpawn", onSpawn);
  try {
    return await toss();
  } finally {
    // The item entity arrives a tick or two after the toss
    setTimeout(() => current.removeListener("entitySpawn", onSpawn), 1000);
  }
}

/**
 * True when there's room for this item: a free slot, or a stack of the same
 * thing that isn't full yet. Unknown items count as fitting only with a free slot.
 */
function hasRoomFor(e: Entity): boolean {
  if (bot.inventory.emptySlotCount() > 0) return true;
  const dropped = (e as Entity & { getDroppedItem?: () => { name: string; count: number } | null }).getDroppedItem?.();
  if (!dropped) return false;
  return bot.inventory.items().some((i) => i.name === dropped.name && i.count < i.stackSize);
}

/** Items within `radius` it may pick up, nearest first. */
/**
 * True for a drop lying on leaves (up in a tree's canopy after its trunk is
 * felled): left until the leaves decay and it falls (game test: four walks
 * of 16 s each to saplings 4 blocks up in the leaves, none got there).
 */
function onLeaves(e: Entity): boolean {
  const under = bot.blockAt?.(e.position.offset(0, -0.3, 0).floored());
  return under?.name.endsWith("_leaves") ?? false;
}

function looseItems(radius: number, skip: Map<number, number>, onlyVisible: boolean, leave: (e: Entity) => boolean = () => false): Entity[] {
  const eyes = bot.entity.position.offset(0, 1.62, 0);
  const world = bot.world as unknown as SightWorld;
  return Object.values(bot.entities)
    .filter((e) => isDroppedItem(e) && !tossedByMe.has(e) && !leave(e) && (skip.get(e.id) ?? 0) < MAX_TRIES_PER_ITEM)
    .filter((e) => (unreachableUntil.get(e) ?? 0) < Date.now() && hasRoomFor(e) && !onLeaves(e))
    .map((e) => ({ e, d: e.position.distanceTo(bot.entity.position) }))
    .filter(({ e, d }) => d <= radius && (!onlyVisible || d <= 3 || canSeePoint(world, eyes, e.position.offset(0, 0.25, 0), radius)))
    .sort((a, b) => a.d - b.d)
    .map(({ e }) => e);
}

/** What a dropped item is ("oak sapling"), for the log. */
function itemName(e: Entity): string {
  const item = (e as Entity & { getDroppedItem?: () => { name: string } | null }).getDroppedItem?.();
  return item?.name.replace(/_/g, " ") ?? "item";
}

/** Resolves true once the item is gone (picked up), false after `ms`. */
async function waitGone(item: Entity, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!bot.entities[item.id]) return true;
    await sleep(100);
  }
  return !bot.entities[item.id];
}

// How close a drop is to be fetched with ordinary walking (a block dug if need be)
const NEAR_DROP = 3;

/**
 * Picks up the items lying within `radius`, nearest first, each one confirmed
 * by the game before moving on. Returns how many item stacks it picked up.
 * `keepGoing` lets a background caller stop as soon as real work starts.
 */
export async function collectDrops(
  radius = 8,
  {
    onlyVisible = false,
    keepGoing = () => true,
    leave = () => false,
  }: { onlyVisible?: boolean; keepGoing?: () => boolean; leave?: (e: Entity) => boolean } = {}
): Promise<number> {
  const skip = new Map<number, number>();
  let collected = 0;
  // Drops from what just happened may still be in the air
  if (looseItems(radius, skip, onlyVisible, leave).some((e) => !e.onGround)) await sleep(SETTLE_MS);

  for (let i = 0; i < MAX_ITEMS; i++) {
    if (isCommandCancelled() || !keepGoing()) break;
    const item = looseItems(radius, skip, onlyVisible, leave)[0];
    if (!item) break; // nothing left it has room for
    const p = item.position;
    // Picking up never digs its own way round (game test: a drop at head
    // height in its mine, and the walk to it cut a new path through the rock
    // beside the tunnel): digging only when there's no other way
    // A drop right beside it (ore it just mined out of a tunnel wall, in the
    // 1-high hole it left) is a block's dig away at most: the usual cost
    // (game test: with digging that dear, working out the way timed out and
    // it gave up on every raw copper, 20 seconds each, "no progress")
    const near = p.distanceTo(bot.entity.position) <= NEAR_DROP;
    const walked = near
      ? await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 1))
      : await pathing.withRules({ digCost: 100 }, () => goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 1)));
    if (!walked.ok) {
      if (wasStopped(walked) || isCommandCancelled() || !keepGoing()) break; // stopped, or real work started
      if (!bot.entities[item.id]) {
        collected++; // picked it up on the way (it rolled to the bot)
        continue;
      }
      console.log(`Can't get to the ${itemName(item)} on the ground: ${describeFailure(walked)}`);
      unreachableUntil.set(item, Date.now() + UNREACHABLE_MS); // ledge, lava, no path: leave it
      continue;
    }
    if (await waitGone(item, PICKUP_WAIT_MS)) collected++;
    else skip.set(item.id, (skip.get(item.id) ?? 0) + 1); // rolled away or still flying: one more try
  }
  if (collected > 0) console.log(`Picked up ${collected} item stack(s).`);
  // Full: make room (store in a chest, or make one) and go back for the rest, once
  const left = leftForLackOfRoom(radius, leave);
  if (left.length > 0 && keepGoing() && !isCommandCancelled()) {
    console.log(`Inventory is full; ${left.length} item(s) still on the ground.`);
    // First the clutter from mining (owner: it killed a sheep and left the
    // wool and the meat, its pockets full of andesite and the like): dropped
    // here, like a player, then the drops picked up
    if (await dropClutter()) {
      collected += await collectDrops(radius, { onlyVisible, keepGoing, leave });
      if (leftForLackOfRoom(radius, leave).length === 0) return collected;
    }
    const { makeRoom } = await import("./overflow");
    // A chore leaves it there: making room (a chest, tossing junk) is for real tasks
    if (!inChore() && (await makeRoom("pick up what's on the ground"))) collected += await collectDrops(radius, { onlyVisible, keepGoing, leave });
  }
  return collected;
}

// Stone it digs through and never uses (and the junk mobs drop): what a
// player throws out first when their pockets are full. Not rotten flesh: it's
// food when there's nothing else (owner)
export const CLUTTER = /^(andesite|diorite|granite|tuff|calcite|dripstone_block|pointed_dripstone|gravel|poisonous_potato|dead_bush|spider_eye)$/;

/** Drops the clutter it carries (never to be picked up again). True when a slot came free. */
async function dropClutter(): Promise<boolean> {
  const stacks = bot.inventory.items().filter((i) => CLUTTER.test(i.name));
  if (stacks.length === 0) return false;
  const before = bot.inventory.emptySlotCount();
  const { discard } = await import("./inventory");
  for (const name of [...new Set(stacks.map((i) => i.name))]) await discard(name);
  const freed = bot.inventory.emptySlotCount() - before;
  if (freed > 0) console.log(`Full: dropped ${[...new Set(stacks.map((i) => i.name.replace(/_/g, " ")))].join(", ")} (${freed} slots free).`);
  return freed > 0;
}

/** Items still lying within `radius` that it has no room for. */
function leftForLackOfRoom(radius: number, leave: (e: Entity) => boolean): Entity[] {
  return Object.values(bot.entities).filter(
    (e) => isDroppedItem(e) && !tossedByMe.has(e) && !leave(e) && e.position.distanceTo(bot.entity.position) <= radius && !hasRoomFor(e)
  );
}

// --- Tidying up while idle ---------------------------------------------------

/**
 * Runs a background job as the one idle chore (see core/chores). Returns
 * false if it didn't run. Not at night unless it's well equipped: chores
 * (scaffolding, replanting, tidying) wait for the morning (game test: taking
 * down its scaffolding at dusk it was out among the mobs, and a creeper got it).
 */
export async function asBackgroundJob(name: string, job: () => Promise<void>): Promise<boolean> {
  const { daylight } = await import("../core/daylight");
  if (!daylight()) {
    const { wellEquipped } = await import("../skills/capabilities");
    if (!wellEquipped()) return false;
  }
  return runChore(name, job);
}

/** True while no command or reflex wants the bot and this chore wasn't stopped. */
export const noRealWork = (): boolean => !isCommandCancelled() && getCurrentCommandName() === null && !isAnyReflexActive();

/** True when nothing else wants the bot: no task, no reflex, not following or riding. */
/** How far an idle chore may take the bot from the owner while the owner is around. */
const STAY_NEAR_OWNER = 16;

/**
 * Whether an idle chore (replanting, taking down scaffolding) may walk to
 * `pos`: while the owner is around, only near them, so the bot doesn't
 * wander off right after being called over.
 */
export function mayWanderTo(pos: { x: number; y: number; z: number }): boolean {
  const owner = ownerEntity();
  if (!owner) return true;
  return owner.position.distanceTo(new Vec3(pos.x, pos.y, pos.z)) <= STAY_NEAR_OWNER;
}

export function isIdle(): boolean {
  return getCurrentCommandName() === null && !isAnyReflexActive() && !areChoresMuted() && !pathing.hasGoal() && !bot.vehicle;
}

/**
 * Called every few seconds: while idle, picks up items it can see nearby.
 * Items lying next to the owner are left alone (the owner may be sorting
 * things out, or about to hand them over).
 */
export async function tidyUpWhileIdle(): Promise<void> {
  if (isChoreRunning() || !isIdle()) return;
  const owner = ownerEntity();
  const nearOwner = (e: Entity): boolean => owner !== null && e.position.distanceTo(owner.position) < 3;
  const items = looseItems(IDLE_RADIUS, new Map(), true, nearOwner);
  if (items.length === 0) return;
  await asBackgroundJob("tidying up", async () => {
    try {
      console.log(`Tidying up: ${items.length} item(s) on the ground nearby.`);
      const stillIdle = (): boolean => {
        markOwnWork(); // its own leftovers, not gifts to thank the owner for
        return noRealWork();
      };
      await collectDrops(IDLE_RADIUS, { onlyVisible: true, keepGoing: stillIdle, leave: nearOwner });
      markOwnWork();
    } catch (error) {
      console.log(`Tidying up stopped: ${(error as Error).message}`);
    }
  });
}

/** How many drops it can see lying within `radius` (not on leaves, not its own tossed ones). */
export function dropsLyingNear(radius: number): number {
  if (!bot.entity) return 0;
  return looseItems(radius, new Map(), true).length;
}

/** Picks up the items within `distance` (see collectDrops above). */
export async function pickupNearbyItems(_bot: Bot, distance = 8): Promise<boolean> {
  await collectDrops(distance);
  return true;
}
