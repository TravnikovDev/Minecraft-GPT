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
import { Vec3 } from "vec3";
import { isOwnBlock } from "./scaffold";
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
// (and wooden fence gates: its fields' gates open and close the same way, owner's fences)
export const isWoodenDoor = (name: string): boolean => (name.endsWith("_door") && name !== "iron_door") || name.endsWith("_fence_gate");

// Its shelter's walls, roof and floor, and its mine stairs' floors and side
// walls: never dug through by a walk or a collect ("stone in sight" carved
// into them; a walk from the grass above dug a hole to the sky over the
// exit; a walk stuck on a step dug around it and broke the stairs, owner:
// "unacceptable"). Set by actions/building and skills/mine, one set each.
const protectedCells = new Map<string, Set<string>>();

/** The cells no walk or collect may break, for one owner of them ("shelter", "mine"); replaces that owner's previous set. */
export function protectCells(cells: Array<{ x: number; y: number; z: number }>, owner = "shelter"): void {
  protectedCells.set(owner, new Set(cells.map((c) => `${c.x},${c.y},${c.z}`)));
}

/** Which of its places keeps this cell ("shelter", "mine"), or null. */
export function protectedBy(p: { x: number; y: number; z: number }): string | null {
  const key = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
  for (const [owner, cells] of protectedCells) if (cells.has(key)) return owner;
  return null;
}

/** True for a protected cell (its shelter's shell, its mine stairs). */
export function isProtected(p: { x: number; y: number; z: number }): boolean {
  const key = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
  for (const cells of protectedCells.values()) if (cells.has(key)) return true;
  return false;
}

// Steps a walk got stuck on (jumping at a ledge it never got up, fresh-world
// test: the next walk planned the very same step, again and again). For a
// minute they cost so much that the route goes another way, as a player would.
const avoidedSteps = new Map<string, number>();
const AVOID_STEP_MS = 60_000;
// A cost, not a ban: the pathfinder drops any move over 100, and one stall in
// the 1-wide shelter stairs must not block the only way in (architect review)
const STUCK_STEP_COST = 15;
// Its own shelter's stairs, doorways and room, and its mine stairs: never avoided
const ownPassages = new Map<string, Set<string>>();
const isOwnPassage = (key: string): boolean => {
  for (const cells of ownPassages.values()) if (cells.has(key)) return true;
  return false;
};

/** The cells of its own passages (shelter, mine stairs): stalls there are never held against them. */
export function setOwnPassages(cells: Array<{ x: number; y: number; z: number }>, owner = "shelter"): void {
  ownPassages.set(owner, new Set(cells.map((c) => `${c.x},${c.y},${c.z}`)));
}

/** A step (the cell it was trying to move into) to route around for a while. */
export function avoidStep(p: { x: number; y: number; z: number }): void {
  const key = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
  if (isOwnPassage(key)) return;
  avoidedSteps.set(key, Date.now() + AVOID_STEP_MS);
}

// A cell where its head would be under water too: a cost, not a ban (a short
// swim stays possible), so a dry way round or a dug way is preferred (game
// test: called to its owner, the shortest way went through a flooded cave
// under a stone ceiling; it ran out of air and lost 6 health)
const SUBMERGED_COST = 6;
const isWet = (b: { name: string; getProperties: () => Record<string, unknown> } | null): boolean =>
  b !== null && (b.name === "water" || b.name === "bubble_column" || b.getProperties()["waterlogged"] === true);

// The sides and top of a block: water or lava there floods in when it's broken
const OPEN_TO = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]] as const;
const LIQUID = /^(water|lava|bubble_column)$/;

/**
 * True when breaking the block at `p` would let water or lava in (some at
 * its sides or on top: owner, never dig a block with water behind it).
 * Pure over `look`.
 */
export function liquidBehind(p: { x: number; y: number; z: number }, look: (x: number, y: number, z: number) => string | null): boolean {
  return OPEN_TO.some(([dx, dy, dz]) => LIQUID.test(look(p.x + dx, p.y + dy, p.z + dz) ?? ""));
}

/** The step cost for cells under water head and feet, for this bot's world. */
const submergedStep = (bot: Bot) => (block: { position?: { x: number; y: number; z: number } }): number => {
  const p = block.position;
  if (!p) return 0;
  const at = (y: number) => bot.blockAt(new Vec3(p.x, y, p.z)) as { name: string; getProperties: () => Record<string, unknown> } | null;
  return isWet(at(p.y)) && isWet(at(p.y + 1)) ? SUBMERGED_COST : 0;
};

function stuckStep(block: { position?: { x: number; y: number; z: number } }): number {
  if (!block.position || avoidedSteps.size === 0) return 0;
  const until = avoidedSteps.get(`${block.position.x},${block.position.y},${block.position.z}`);
  return until !== undefined && until > Date.now() ? STUCK_STEP_COST : 0;
}

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
  if (neighbors.length > before && added.toBreak.some((p) => !isOwnBlock(p))) neighbors.pop();
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
      if (block?.position && isOwnBlock(block.position, block.name)) {
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
  // Never through a sweet berry bush (they hurt: 7 health on one walk, then
  // a zombie finished it, fresh-world test); walking right next to one is
  // fine (owner: avoid them, but only by the one block)
  const berries = bot.registry.blocksByName["sweet_berry_bush"]?.id;
  if (berries !== undefined) moves.blocksToAvoid.add(berries);
  // Areas it must keep out of (core/forbidden): never dig there (a hard ban),
  // and building there costs too much to choose (the primitives refuse it anyway)
  const keepOut = (block: { position?: { x: number; y: number; z: number } }): number =>
    block.position && (forbiddenAt(block.position) || isProtected(block.position)) ? 10_000 : 0;
  moves.exclusionAreasStep = [stuckStep, submergedStep(bot)] as unknown as typeof moves.exclusionAreasStep;
  // Never a block with water or lava behind it (owner: its own way dug
  // through a flooded dripstone cave let the water in, and it nearly drowned)
  const look = (x: number, y: number, z: number): string | null => bot.blockAt(new Vec3(x, y, z))?.name ?? null;
  const floods = (block: { position?: { x: number; y: number; z: number } }): number => (block.position && liquidBehind(block.position, look) ? 10_000 : 0);
  moves.exclusionAreasBreak = [keepOut, floods] as unknown as typeof moves.exclusionAreasBreak;
  // Never a scaffold block in its own shelter's stairs, doorways or room (a
  // walk out of it put dirt in a furniture spot, fresh-world test)
  const ownSpace = (block: { position?: { x: number; y: number; z: number } }): number =>
    block.position && isOwnPassage(`${block.position.x},${block.position.y},${block.position.z}`) ? 10_000 : 0;
  const placeRules = (block: { position?: { x: number; y: number; z: number } }): number => keepOut(block) + ownSpace(block);
  moves.exclusionAreasPlace = [placeRules] as typeof moves.exclusionAreasPlace;
  moves.canOpenDoors = true; // fence gates
  // Everything else is mineflayer-pathfinder's own defaults (drops, digging,
  // pillaring, parkour, sprinting): every tweak of them made the walking
  // worse somewhere (owner: fewer limits, fewer bugs). The exceptions (besides
  // berry bushes above) are both about placing blocks: a block costs 6, not 1, and no 1x1 pillars;
  // otherwise the search weighs building everywhere, runs out of time
  // ("partial" paths) and digs shafts instead of stairs (tests/noShafts)
  moves.placeCost = 6;
  moves.allow1by1towers = false; // same reason: pillars widen the search
  safeRules.add(moves);
  return moves;
}
