// Path: src/core/movements.ts
// The one set of walking rules (pathfinder Movements) used everywhere. Before
// this, several actions created fresh default Movements, which dig through any
// block and never use doors: the bot broke the walls of the owner's house (and
// a dragon egg) to reach a bed instead of using the door.
//
// Rules:
// - While walking, the bot may only dig through natural terrain (dirt, stone,
//   sand, leaves...). Anything built (planks, cobblestone, glass, bricks,
//   doors, beds, chests, decorations) is never broken to get somewhere.
// - No vertical shafts: it never digs the block under its feet to go
//   straight down, or the block over its head to go straight up. Like a
//   player, it digs stairs (one forward, one down or up) instead.
// - Wooden doors count as passable; actions/doors.ts opens them as the bot
//   walks through and closes them behind it. Fence gates use the pathfinder's
//   own gate opening.

import type { Bot } from "mineflayer";
import pf from "mineflayer-pathfinder";
import { isOwnScaffold } from "./scaffold";
import { forbiddenAt } from "./forbidden";

// Natural blocks the bot may dig through when its path needs it
const NATURAL = [
  /^(dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|muddy_mangrove_roots|clay|gravel|sand|red_sand)$/,
  /^(stone|deepslate|andesite|diorite|granite|tuff|calcite|dripstone_block|pointed_dripstone|sandstone|red_sandstone)$/,
  /^(netherrack|soul_sand|soul_soil|basalt|blackstone|end_stone|magma_block)$/,
  /^(snow|snow_block|moss_block|moss_carpet|terracotta|[a-z_]+_terracotta)$/,
  /_ore$/,
  /_leaves$/,
  /^(short_grass|grass|tall_grass|fern|large_fern|dead_bush|vine|glow_lichen|hanging_roots|sweet_berry_bush)$/,
];
export const isNatural = (name: string): boolean => !name.includes("glazed") && NATURAL.some((re) => re.test(name));

// Doors that didn't open when the bot used them (a protected area, adventure
// mode): the path search treats them as walls again until the next connection
const solidDoors = new Set<string>();
const posKey = (p: { x: number; y: number; z: number }): string => `${p.x},${p.y},${p.z}`;

/** A door that wouldn't open: route around it (both halves). */
export function markDoorSolid(lower: { x: number; y: number; z: number }): void {
  solidDoors.add(posKey(lower));
  solidDoors.add(posKey({ x: lower.x, y: lower.y + 1, z: lower.z }));
}

/** Forgets doors that wouldn't open (a new connection). */
export function clearSolidDoors(): void {
  solidDoors.clear();
}

/** Wooden doors (iron doors need redstone, so they stay walls). */
export const isWoodenDoor = (name: string): boolean => name.endsWith("_door") && name !== "iron_door";

// Every walking-rules object built here (anything else digs through walls)
const safeRules = new WeakSet<object>();

/** True when these are walking rules built by safeMovements. */
export const isSafeMovements = (moves: unknown): boolean => typeof moves === "object" && moves !== null && safeRules.has(moves);

// The bot's one shared set of walking rules (per connection: per Bot object)
const sharedRules = new WeakMap<Bot, pf.Movements>();

/**
 * The walking rules everyone uses, built once per connection. Building them
 * walks the whole block registry, so callers must not rebuild them; changing
 * a setting on this object changes it for every walk.
 */
export function walkingRules(bot: Bot): pf.Movements {
  let rules = sharedRules.get(bot);
  if (!rules) {
    rules = safeMovements(bot);
    sharedRules.set(bot, rules);
  }
  return rules;
}

/**
 * Runs a move generator and drops the move it added if that move digs, unless
 * all it digs is the bot's own scaffolding (climbing down its own pillar is
 * how a player gets off one).
 */
function withoutDigging(neighbors: { toBreak: { x: number; y: number; z: number }[] }[], generate: () => void): void {
  const before = neighbors.length;
  generate();
  const added = neighbors[neighbors.length - 1];
  if (neighbors.length > before && added.toBreak.some((p) => !isOwnScaffold(p))) neighbors.pop();
}

/** Builds a fresh copy of the walking rules (only for a one-off variant, e.g. no digging). */
export function safeMovements(bot: Bot): pf.Movements {
  const doorIds = new Set(bot.registry.blocksArray.filter((b) => isWoodenDoor(b.name)).map((b) => b.id));

  // Doors read as open air to the path search; the door opener does the rest
  class SafeMovements extends pf.Movements {
    getBlock(...args: Parameters<pf.Movements["getBlock"]>): ReturnType<pf.Movements["getBlock"]> {
      const block = super.getBlock(...args);
      if (block && doorIds.has(block.type) && !solidDoors.has(posKey(block.position))) {
        block.safe = true;
        block.physical = false;
        block.replaceable = false;
        // The pathfinder clicks "openable" blocks that have a shape; a door has
        // one open or closed, so it would shut an open door in the bot's face.
        // actions/doors.ts opens and closes doors instead.
        block.openable = false;
      }
      return block;
    }

    // Its own scaffolding (cobblestone, dirt) may be taken down, though it
    // looks built: nothing else it placed or anyone built is ever broken
    safeToBreak(...args: Parameters<pf.Movements["safeToBreak"]>): boolean {
      const [block] = args;
      // Never in an area it must keep out of, its own scaffolding included
      if (block?.position && forbiddenAt(block.position)) return false;
      if (block?.position && isOwnScaffold(block.position, block.name)) {
        // Only "built" is waived: next to water or lava, or under sand and
        // gravel, its own scaffolding stays too (same checks as for any block)
        if (!this.canDig) return false;
        const p = block.position;
        const near = (dx: number, dy: number, dz: number) =>
          this.getBlock(p as never, dx, dy, dz) as unknown as { liquid?: boolean; canFall?: boolean };
        if (this.dontCreateFlow && [near(0, 1, 0), near(-1, 0, 0), near(1, 0, 0), near(0, 0, -1), near(0, 0, 1)].some((b) => b.liquid)) return false;
        if (this.dontMineUnderFallingBlock && near(0, 1, 0).canFall) return false;
        return true;
      }
      return super.safeToBreak(...args);
    }

    // Straight down by digging the block underfoot: a 1x1 shaft no player
    // digs. Falling into an existing hole or climbing down a ladder is fine.
    getMoveDown(...args: Parameters<pf.Movements["getMoveDown"]>): void {
      withoutDigging(args[1], () => super.getMoveDown(...args));
    }

    // Straight up by digging the block overhead (pillaring through the
    // ceiling). Climbing a ladder or pillaring in the open is fine.
    getMoveUp(...args: Parameters<pf.Movements["getMoveUp"]>): void {
      withoutDigging(args[1], () => super.getMoveUp(...args));
    }
  }

  const moves = new SafeMovements(bot);
  // In the pathfinder's openable set, a door is walked through at the middle
  // of its floor; otherwise the bot aims at the top of the swung-open door
  // leaf, can never get there and stands in the doorway until "stuck"
  for (const id of doorIds) moves.openable.add(id);
  for (const block of bot.registry.blocksArray) {
    if (!isNatural(block.name)) moves.blocksCantBreak.add(block.id);
  }
  moves.canDig = true; // natural terrain only (see above)
  // Areas it must keep out of (core/forbidden): never dig there (a hard ban),
  // and building there costs too much to choose (the primitives refuse it anyway)
  const keepOut = (block: { position?: { x: number; y: number; z: number } }): number => (block.position && forbiddenAt(block.position) ? 10_000 : 0);
  moves.exclusionAreasBreak = [keepOut] as typeof moves.exclusionAreasBreak;
  moves.exclusionAreasPlace = [keepOut] as typeof moves.exclusionAreasPlace;
  moves.canOpenDoors = true; // fence gates
  // No pillaring just to get somewhere (following, walking up to the owner):
  // a player walks around. Reaching a block up high turns it on for that walk
  moves.allow1by1towers = false;
  moves.maxDropDown = 5;
  moves.digCost = 6;
  moves.placeCost = 6;
  moves.entityCost = 6;
  safeRules.add(moves);
  return moves;
}
