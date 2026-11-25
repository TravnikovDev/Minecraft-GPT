// Path: src/actions/storage.ts
// Using chests like a player: remember them and what's inside, put things
// away (named items, spare resources, duplicate gear, or everything), take
// things out, and say what's where.
//
// What to store is decided by a pure planner (chooseToStore), so the rules
// can be tested without a game: the bot always keeps its best tool of each
// kind, its best weapon and armor, food, torches, ammo, its bed and its
// crafting table unless told to store everything.

import { Vec3 } from "vec3";
import type { Block } from "prismarine-block";
import type { Item } from "prismarine-item";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { closeStorage, depositInto, openStorage, STORAGE_BLOCKS, withdrawFrom, type OpenContainer } from "../core/containers";
import { goTo } from "../core/primitives";
import { ago } from "./perception";
import { describeFailure, expectOk, explain, wasStopped } from "../core/result";
import { forgetChest, loadChests, rememberChest, type KnownChest } from "../core/session";
import { shelter } from "../skills/capabilities";
import { itemMatcher } from "./inventory";
import { countList } from "./hunting";

// --- What to store (pure) -------------------------------------------------------

/** One stack in the inventory, as the planner sees it. */
export type Stack = { name: string; count: number; type: number; nbt?: unknown };
/** How much of which stack to put away. */
export type Deposit = { stack: Stack; count: number };
export type StoreMode = "items" | "resources" | "lowValue" | "room" | "duplicates" | "all";
export type Wanted = { name: string; count: number | null };

const OTHER_GEAR = new Set(["bow", "crossbow", "shield", "trident", "fishing_rod", "shears", "flint_and_steel", "elytra", "spyglass"]);
const SUPPLIES = new Set(["torch", "crafting_table", "arrow", "spectral_arrow", "tipped_arrow"]);
/** Things nobody needs to carry around (some count as food, but nobody eats them by choice). */
const JUNK = new Set(["rotten_flesh", "poisonous_potato", "dead_bush", "spider_eye"]);

/** Tools, weapons and armor: one of each kind is what the bot works with. */
export function gearKind(name: string): string | null {
  const c = catalog();
  const tool = c.toolKind(name);
  if (tool) return tool;
  const armor = c.armorSlot(name);
  if (armor) return `armor:${armor}`;
  return OTHER_GEAR.has(name) ? name : null;
}

/** Better gear ranks higher: material tier (netherite > diamond > iron...). */
function gearRank(name: string): number {
  const c = catalog();
  return Math.max(c.toolTier(name), c.armorTier(name), 0);
}

// Bulk blocks and common drops: cheap, quick to get again
const BULK = /^(dirt|coarse_dirt|rooted_dirt|cobblestone|cobbled_deepslate|netherrack|gravel|sand|red_sand|stone|deepslate|andesite|diorite|granite|tuff|calcite|dripstone_block|clay_ball|kelp|stick|[a-z_]+_seeds|[a-z_]+_sapling|mangrove_propagule|dandelion|poppy|short_grass|fern|vine)$/;
// Precious: kept on the bot, never stored as "less valuable" (mineral blocks by
// exact name: "_block" alone also matches hay, bone and dripstone blocks)
const PRECIOUS = /^(diamond|emerald|lapis_lazuli|redstone|quartz|amethyst_shard|ender_pearl|blaze_rod|netherite_scrap|ancient_debris|golden_apple|enchanted_golden_apple|enchanted_book|experience_bottle|name_tag|saddle|totem_of_undying|nether_star|heart_of_the_sea|[a-z_]+_ingot|raw_gold|gold_nugget|(?:iron|gold|diamond|emerald|lapis|redstone|netherite|copper|raw_iron|raw_gold|raw_copper)_block)$/;

/**
 * How much an item is worth keeping: 0 junk, 1 bulk blocks and common bits,
 * 2 ordinary materials (logs, coal, raw iron, wool...), 3 precious.
 */
export function itemValue(name: string): number {
  if (JUNK.has(name)) return 0;
  if (BULK.test(name)) return 1;
  if (PRECIOUS.test(name)) return 3;
  return 2;
}

/** What a player keeps on them when putting resources away. */
function isKept(name: string): boolean {
  if (JUNK.has(name)) return false;
  return gearKind(name) !== null || catalog().isFood(name) || catalog().isBed(name) || SUPPLIES.has(name);
}

/**
 * Supplies a player keeps a working amount of when clearing space, so the job
 * at hand goes on: coal for torches, sticks, and logs for planks, sticks or a
 * crafting table. The rest of the stack is put away.
 */
const WORKING_SUPPLY: Array<[(name: string) => boolean, number]> = [
  [(n) => n === "coal" || n === "charcoal", 16],
  [(n) => n === "stick", 16],
  [(n) => catalog().isLog(n), 8],
];

/**
 * Kept even when making room: a little stone for floors and plugs in its
 * tunnels (it put all 383 away and had nothing to floor a drop with,
 * fresh-world test). Putting things away keeps more (BUILDING_SUPPLY).
 */
const TUNNEL_SUPPLY: Array<[(name: string) => boolean, number]> = [
  [(n) => n === "cobblestone" || n === "cobbled_deepslate", 16],
];

/**
 * Also kept when putting things away (not when making room, where the pile
 * of cobblestone is the first thing to go): building and patching stone,
 * since storing it all left nothing to patch the shelter or mine with.
 */
const BUILDING_SUPPLY: Array<[(name: string) => boolean, number]> = [
  [(n) => n === "cobblestone" || n === "cobbled_deepslate", 32],
  [(n) => n === "dirt", 16],
];

/**
 * The cheapest whole stacks, enough to free `slots` slots (a part-stack frees
 * none). Kind by kind, cheapest first, and the kind with the most of it first
 * (a player puts away the pile of cobblestone, not one odd stack).
 */
function cheapestStacks(deposits: Deposit[], slots: number): Deposit[] {
  const whole = deposits.filter((d) => d.count === d.stack.count);
  const kinds = new Map<string, Deposit[]>();
  for (const d of whole) kinds.set(d.stack.name, [...(kinds.get(d.stack.name) ?? []), d]);
  const total = (ds: Deposit[]): number => ds.reduce((a, d) => a + d.count, 0);
  const order = [...kinds.entries()].sort(
    ([a, da], [b, db]) => itemValue(a) - itemValue(b) || db.length - da.length || total(db) - total(da)
  );
  const out: Deposit[] = [];
  for (const [, ds] of order) {
    if (out.length >= slots) break;
    out.push(...ds);
  }
  return out;
}

/** Slots a full inventory frees: about a tenth of it, the cheapest stacks. */
export const ROOM_SLOTS = 4;

/**
 * Decides what to put in the chest.
 * - items: the named items (exact names or categories like "planks", "logs"), `count` or all of them
 * - resources: everything except gear, food, torches, ammo, the bed and the crafting table
 * - lowValue: resources minus precious things (ingots, diamonds, redstone...)
 * - room: making room when full: only the cheapest whole stacks of lowValue,
 *   about a tenth of the inventory (ROOM_SLOTS), junk and bulk first
 * - duplicates: extra copies; the best tool/weapon/armor piece of each kind and
 *   the biggest stack of each item stay
 * - all: everything it carries
 */
export function chooseToStore(stacks: Stack[], mode: StoreMode, wanted: Wanted[] = [], keep: string[] = []): Deposit[] {
  if (mode === "all") return stacks.map((stack) => ({ stack, count: stack.count }));
  if (mode === "resources") return stacks.filter((s) => !isKept(s.name)).map((stack) => ({ stack, count: stack.count }));
  // lowValue: like resources, but precious things (ingots, gems, redstone...) stay too
  // `keep`: what the current job needs (e.g. the ore it's mining) stays too
  if (mode === "lowValue" || mode === "room") {
    const supply = mode === "lowValue" ? [...WORKING_SUPPLY, ...BUILDING_SUPPLY] : [...WORKING_SUPPLY, ...TUNNEL_SUPPLY];
    const reserve = supply.map(([matches, amount]) => ({ matches, left: amount }));
    const deposits: Deposit[] = [];
    for (const stack of stacks) {
      if (isKept(stack.name) || itemValue(stack.name) > 2 || keep.includes(stack.name)) continue;
      const r = reserve.find((x) => x.matches(stack.name));
      const held = r ? Math.min(r.left, stack.count) : 0;
      if (r) r.left -= held;
      if (stack.count - held > 0) deposits.push({ stack, count: stack.count - held });
    }
    return mode === "room" ? cheapestStacks(deposits, ROOM_SLOTS) : deposits;
  }

  if (mode === "duplicates") {
    const out: Deposit[] = [];
    const groups = new Map<string, Stack[]>();
    for (const s of stacks) {
      const key = gearKind(s.name) ?? `item:${s.name}`;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    for (const [key, group] of groups) {
      if (group.length < 2) continue;
      const keep = key.startsWith("item:")
        ? group.reduce((a, b) => (b.count > a.count ? b : a)) // the biggest stack
        : group.reduce((a, b) => (gearRank(b.name) > gearRank(a.name) ? b : a)); // the best piece
      for (const s of group) if (s !== keep) out.push({ stack: s, count: s.count });
    }
    return out;
  }

  // items: what the owner named
  const out: Deposit[] = [];
  for (const w of wanted) {
    const matches = itemMatcher(w.name);
    let left = w.count ?? Infinity;
    for (const s of stacks) {
      if (left <= 0) break;
      if (!matches(s.name) || out.some((d) => d.stack === s)) continue;
      const n = Math.min(s.count, left);
      out.push({ stack: s, count: n });
      left -= n;
    }
  }
  return out;
}

/** Item counts by name ("cobblestone" -> 128). */
export function tally(items: { name: string; count: number }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.name, (counts.get(i.name) ?? 0) + i.count);
  return counts;
}

// --- Finding and remembering chests ------------------------------------------------

const SEARCH_RADIUS = 32;
const REMEMBERED_RANGE = 96;
const dimension = (): string => (bot.game as { dimension?: string }).dimension ?? "overworld";
const at = (c: { x: number; y: number; z: number }): string => `${c.x}, ${c.y}, ${c.z}`;
const pretty = (name: string): string => name.replace(/_/g, " ");

/** A known chest that is really still there (forgets it if the spot is loaded and it's gone). */
async function stillThere(c: KnownChest): Promise<Block | null> {
  const block = bot.blockAt(new Vec3(c.x, c.y, c.z));
  if (!block) return null; // too far to see: can't tell
  if (STORAGE_BLOCKS.has(block.name)) return block;
  await forgetChest(c);
  return null;
}

/**
 * The chest to use: a remembered one (nearest first; for taking items, one
 * that had them), else the nearest chest or barrel it can see around.
 */
export async function chooseChest(holding?: (contents: Record<string, number>) => boolean, ownOnly = false): Promise<Block | null> {
  const me = bot.entity.position;
  const known = loadChests()
    .filter((c) => (!ownOnly || ownChest(c)) && c.dimension === dimension() && me.distanceTo(new Vec3(c.x, c.y, c.z)) <= REMEMBERED_RANGE)
    // A chest never opened (contents unknown) can't be said to hold anything
    .filter((c) => !holding || (c.contents !== null && holding(c.contents)))
    .sort((a, b) => me.distanceTo(new Vec3(a.x, a.y, a.z)) - me.distanceTo(new Vec3(b.x, b.y, b.z)));
  for (const c of known) {
    const block = await stillThere(c);
    if (block) return block;
  }
  // Looking for one that holds something: only chests it knows hold it, never
  // whatever chest is around (architect review: it would open strange chests)
  if (holding) return null;
  const ids = [...STORAGE_BLOCKS].map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  return bot.findBlock({ matching: ids, maxDistance: SEARCH_RADIUS });
}

/** Walks to a chest, opens it, runs `use`, remembers what's inside, closes it. */
export async function withChest<T>(block: Block, use: (open: OpenContainer) => Promise<T>): Promise<T> {
  const p = block.position;
  expectOk(await goTo(new pf.goals.GoalGetToBlock(p.x, p.y, p.z)));
  const open = expectOk(await openStorage(block));
  try {
    return await use(open);
  } finally {
    const contents = Object.fromEntries(tally(open.containerItems()));
    await closeStorage(open);
    await rememberChest({ x: p.x, y: p.y, z: p.z, dimension: dimension(), contents, seenAt: Date.now() });
  }
}

/** Opens a chest just to see (and remember) what's inside. */
export async function lookInChest(block: Block): Promise<Map<string, number>> {
  return withChest(block, async (open) => tally(open.containerItems()));
}

// --- Putting things away and taking them out ------------------------------------------

export type StoreResult = {
  stored: Map<string, number>;
  leftOver: Map<string, number>;
  chestAt: string;
  /** Why it couldn't use the chest at all (couldn't get there, couldn't open it). */
  problem?: string;
} | null;

/** Puts items in the nearest known chest. Returns what went in and what didn't fit (null: no chest). */
export async function storeItems(mode: StoreMode, wanted: Wanted[] = [], keep: string[] = []): Promise<StoreResult> {
  const stacks: Stack[] = bot.inventory.items().map((i: Item) => ({ name: i.name, count: i.count, type: i.type, nbt: i.nbt }));
  const plan = chooseToStore(stacks, mode, wanted, keep);
  const chest = await chooseChest();
  if (!chest) return null;
  const stored = new Map<string, number>();
  const leftOver = new Map<string, number>();
  if (plan.length === 0) return { stored, leftOver, chestAt: at(chest.position) };

  try {
    await withChest(chest, async (open) => {
      for (const { stack, count } of plan) {
        const item = bot.inventory.items().find((i) => i.type === stack.type && i.count >= 1 && (stack.nbt === undefined || i.nbt === stack.nbt));
        const moved = item ? await depositInto(open, item, count) : null;
        if (moved?.ok) stored.set(stack.name, (stored.get(stack.name) ?? 0) + moved.value);
        const missed = count - (moved?.ok ? moved.value : 0);
        if (missed > 0) {
          if (moved && !moved.ok) console.log(`Couldn't put ${count} ${stack.name} in the chest: ${describeFailure(moved)}`);
          leftOver.set(stack.name, (leftOver.get(stack.name) ?? 0) + missed);
        }
        if (moved && !moved.ok && wasStopped(moved)) break;
      }
    });
  } catch (error) {
    return { stored, leftOver, chestAt: at(chest.position), problem: explain(error) };
  }
  return { stored, leftOver, chestAt: at(chest.position) };
}

export type TakeResult = {
  taken: Map<string, number>;
  missing: string[];
  full: boolean;
  chestAt: string;
  /** Why it couldn't use the chest at all. */
  problem?: string;
} | null;

/**
 * Takes items (or everything, with no list) from the chest that has them.
 * `ownOnly`: only from its own chests that had them (the planner), never the
 * nearest chest around.
 */
export async function takeItems(wanted: Wanted[] | null, ownOnly = false): Promise<TakeResult> {
  const holds = (contents: Record<string, number>): boolean =>
    !wanted || wanted.some((w) => Object.keys(contents).some(itemMatcher(w.name)));
  const chest = ownOnly ? await chooseChest(holds, true) : ((await chooseChest(holds)) ?? (await chooseChest()));
  if (!chest) return null;
  const taken = new Map<string, number>();
  const missing: string[] = [];
  let full = false;

  try {
    await withChest(chest, async (open) => {
      const asks: Wanted[] = wanted ?? [...tally(open.containerItems()).keys()].map((name) => ({ name, count: null }));
      for (const w of asks) {
        const matches = itemMatcher(w.name);
        let left = w.count ?? Infinity;
        const there = open.containerItems().filter((i) => matches(i.name));
        if (there.length === 0) missing.push(pretty(w.name));
        for (const item of there) {
          if (left <= 0 || full) break;
          const moved = await withdrawFrom(open, item, Math.min(item.count, left));
          if (moved.ok) {
            taken.set(item.name, (taken.get(item.name) ?? 0) + moved.value);
            left -= moved.value;
          } else {
            console.log(`Couldn't take ${item.name}: ${describeFailure(moved)}`);
            full = moved.reason === "full";
            if (wasStopped(moved)) return;
          }
        }
      }
    });
  } catch (error) {
    return { taken, missing, full, chestAt: at(chest.position), problem: explain(error) };
  }
  return { taken, missing, full, chestAt: at(chest.position) };
}

// Its shelter's chests count as its own (older memory has no "own" mark)
const SHELTER_CHEST_RANGE = 8;

/** True for a chest of its own: one it placed, or one in its shelter. Never the owner's or one it found. */
function ownChest(c: KnownChest): boolean {
  if (c.own) return true;
  const home = shelter();
  return home !== null && new Vec3(home.x, home.y, home.z).distanceTo(new Vec3(c.x, c.y, c.z)) <= SHELTER_CHEST_RANGE;
}

/**
 * How many of an item (exact name or group like "logs") its own chests
 * within `range` hold, as last seen. Only its own: the owner's chests it has
 * looked into are the owner's (architect review).
 */
export function storedNear(itemName: string, range = REMEMBERED_RANGE): number {
  if (!bot.entity) return 0;
  const matches = itemMatcher(itemName);
  const me = bot.entity.position;
  return loadChests()
    .filter((c) => ownChest(c) && c.dimension === dimension() && me.distanceTo(new Vec3(c.x, c.y, c.z)) <= range)
    .reduce((n, c) => n + Object.entries(c.contents ?? {}).filter(([name]) => matches(name)).reduce((m, [, k]) => m + k, 0), 0);
}

/** Where an item is stored, from what it saw in its chests (this dimension): "12 diamonds in the chest at x, y, z (checked 2 h ago)". */
export function whereStored(itemName: string): string[] {
  const matches = itemMatcher(itemName);
  const found: string[] = [];
  for (const c of loadChests().filter((c) => c.dimension === dimension())) {
    const here = Object.entries(c.contents ?? {}).filter(([name]) => matches(name));
    if (here.length > 0) found.push(`${countList(new Map(here))} in the chest at ${at(c)} (checked ${ago(c.seenAt)})`);
  }
  return found;
}

/** A short "what's inside" for chat. */
export function describeContents(contents: Map<string, number>, max = 10): string {
  if (contents.size === 0) return "nothing";
  const sorted = new Map([...contents.entries()].sort((a, b) => b[1] - a[1]).slice(0, max));
  const more = contents.size > max ? ` and ${contents.size - max} more kinds` : "";
  return `${countList(sorted)}${more}`;
}

// --- Making room ---------------------------------------------------------------------


/** True when there's no free slot (crafting then would lose its result). */
export function inventoryFull(): boolean {
  return bot.inventory.emptySlotCount() === 0;
}
