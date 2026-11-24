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
// - Wooden doors count as passable; actions/doors.ts opens them as the bot
//   walks through and closes them behind it. Fence gates use the pathfinder's
//   own gate opening.

import type { Bot } from "mineflayer";
import pf from "mineflayer-pathfinder";

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
const isNatural = (name: string): boolean => !name.includes("glazed") && NATURAL.some((re) => re.test(name));

/** Wooden doors (iron doors need redstone, so they stay walls). */
export const isWoodenDoor = (name: string): boolean => name.endsWith("_door") && name !== "iron_door";

// Every walking-rules object built here (anything else digs through walls)
const safeRules = new WeakSet<object>();

/** True when these are walking rules built by safeMovements. */
export const isSafeMovements = (moves: unknown): boolean => typeof moves === "object" && moves !== null && safeRules.has(moves);

/** Builds the walking rules for a bot. */
export function safeMovements(bot: Bot): pf.Movements {
  const doorIds = new Set(bot.registry.blocksArray.filter((b) => isWoodenDoor(b.name)).map((b) => b.id));

  // Doors read as open air to the path search; the door opener does the rest
  class SafeMovements extends pf.Movements {
    getBlock(...args: Parameters<pf.Movements["getBlock"]>): ReturnType<pf.Movements["getBlock"]> {
      const block = super.getBlock(...args);
      if (block && doorIds.has(block.type)) {
        block.safe = true;
        block.physical = false;
        block.replaceable = false;
      }
      return block;
    }
  }

  const moves = new SafeMovements(bot);
  for (const block of bot.registry.blocksArray) {
    if (!isNatural(block.name)) moves.blocksCantBreak.add(block.id);
  }
  moves.canDig = true; // natural terrain only (see above)
  moves.canOpenDoors = true; // fence gates
  moves.allow1by1towers = true;
  moves.maxDropDown = 5;
  moves.digCost = 6;
  moves.placeCost = 6;
  moves.entityCost = 6;
  safeRules.add(moves);
  return moves;
}
