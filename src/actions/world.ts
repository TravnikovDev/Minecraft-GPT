// src/actions/world.ts

import { Block } from "prismarine-block";
import { Movements, goals } from "mineflayer-pathfinder";
import * as gameData from "../utils/minecraftData";
import { Vec3 } from "vec3";
import { Entity } from "prismarine-entity";
import { Item } from "prismarine-item";
import { bot } from "..";

export function getNearestFreeSpace(
  size: number = 1,
  distance: number = 8
): Vec3 | undefined {
  /**
   * Get the nearest empty space with solid blocks beneath it of the given size.
   * @param {number} size - The (size x size) of the space to find, default 1.
   * @param {number} distance - The maximum distance to search, default 8.
   * @returns {Vec3} - The south west corner position of the nearest free space.
   * @example
   * let position = world.getNearestFreeSpace( 1, 8);
   **/
  const empty_pos = bot.findBlocks({
    matching: (block: Block | null) => {
      return block !== null && block.name === "air";
    },
    maxDistance: distance,
    count: 1000,
  });

  for (let i = 0; i < empty_pos.length; i++) {
    let empty = true;
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        const top = bot.blockAt(empty_pos[i].offset(x, 0, z));
        const bottom = bot.blockAt(empty_pos[i].offset(x, -1, z));
        if (
          !top ||
          top.name !== "air" ||
          !bottom ||
          (bottom.drops?.length ?? 0) === 0 ||
          !bottom.diggable
        ) {
          empty = false;
          break;
        }
      }
      if (!empty) break;
    }
    if (empty) {
      return empty_pos[i];
    }
  }
  return undefined;
}

export function getNearestBlocks(
  block_types: string[] | string | null = null,
  distance: number = 16,
  count: number = 10000
): Block[] {
  /**
   * Get a list of the nearest blocks of the given types.
   * @param {string[]} block_types - The names of the blocks to search for.
   * @param {number} distance - The maximum distance to search, default 16.
   * @param {number} count - The maximum number of blocks to find, default 10000.
   * @returns {Block[]} - The nearest blocks of the given type.
   * @example
   * let woodBlocks = world.getNearestBlocks( ['oak_log', 'birch_log'], 16, 1);
   **/
  let block_ids: number[] = [];
  if (block_types === null) {
    block_ids = gameData.getAllBlockIds(["air"]);
  } else {
    if (!Array.isArray(block_types)) block_types = [block_types];
    for (const block_type of block_types) {
      const block_id = gameData.getBlockId(block_type);
      if (block_id !== null) {
        block_ids.push(block_id);
      }
    }
  }

  const positions = bot.findBlocks({
    matching: block_ids,
    maxDistance: distance,
    count: count,
  });

  const blocks: { block: Block; distance: number }[] = [];
  for (let i = 0; i < positions.length; i++) {
    const block = bot.blockAt(positions[i]);
    if (block) {
      const dist = positions[i].distanceTo(bot.entity.position);
      blocks.push({ block: block, distance: dist });
    }
  }
  blocks.sort((a, b) => a.distance - b.distance);

  return blocks.map((item) => item.block);
}

export function getNearestBlock(
  block_type: string,
  distance: number = 16
): Block | undefined {
  /**
   * Get the nearest block of the given type.
   * @param {string} block_type - The name of the block to search for.
   * @param {number} distance - The maximum distance to search, default 16.
   * @returns {Block} - The nearest block of the given type.
   * @example
   * let coalBlock = world.getNearestBlock( 'coal_ore', 16);
   **/
  const blocks = getNearestBlocks(block_type, distance, 1);
  if (blocks.length > 0) {
    return blocks[0];
  }
  return undefined;
}

export function getNearbyEntities(maxDistance: number = 16): Entity[] {
  const entitiesWithDistance: { entity: Entity; distance: number }[] = [];
  for (const entity of Object.values(bot.entities)) {
    const distance = entity.position.distanceTo(bot.entity.position);
    if (distance > maxDistance) continue;
    entitiesWithDistance.push({ entity: entity, distance: distance });
  }
  entitiesWithDistance.sort((a, b) => a.distance - b.distance);
  return entitiesWithDistance.map((item) => item.entity);
}

export function getNearestEntityWhere(
  predicate: (entity: Entity) => boolean,
  maxDistance: number = 16
): Entity | null {
  return bot.nearestEntity(
    (entity) =>
      predicate(entity) &&
      bot.entity.position.distanceTo(entity.position) < maxDistance
  );
}

export function getNearbyPlayers(maxDistance: number = 16): Entity[] {
  const playersWithDistance: { entity: Entity; distance: number }[] = [];
  for (const entity of Object.values(bot.entities)) {
    const distance = entity.position.distanceTo(bot.entity.position);
    if (distance > maxDistance) continue;
    if (entity.type === "player" && entity.username !== bot.username) {
      playersWithDistance.push({ entity: entity, distance: distance });
    }
  }
  playersWithDistance.sort((a, b) => a.distance - b.distance);
  return playersWithDistance.map((item) => item.entity);
}

export function getInventoryStacks(): Item[] {
  const inventory: Item[] = [];
  for (const item of bot.inventory.items()) {
    if (item != null) {
      inventory.push(item);
    }
  }
  return inventory;
}

export function getInventoryCounts(): {
  [key: string]: number;
} {
  /**
   * Get an object representing the bot's inventory.
   * @returns {object} - An object with item names as keys and counts as values.
   * @example
   * let inventory = world.getInventoryCounts(bot);
   * let oakLogCount = inventory['oak_log'];
   * let hasWoodenPickaxe = inventory['wooden_pickaxe'] > 0;
   **/
  const inventory: { [key: string]: number } = {};
  for (const item of bot.inventory.items()) {
    if (item != null) {
      if (inventory[item.name] == null) {
        inventory[item.name] = 0;
      }
      inventory[item.name] += item.count;
    }
  }
  return inventory;
}

export function getPosition(): Vec3 {
  /**
   * Get your position in the world (Note that y is vertical).
   * @returns {Vec3} - An object with x, y, and z attributes representing the position of the bot.
   * @example
   * let position = world.getPosition(bot);
   * let x = position.x;
   **/
  return bot.entity.position;
}

export function getNearbyEntityTypes(): string[] {
  /**
   * Get a list of all nearby mob types.
   * @returns {string[]} - A list of all nearby mobs.
   * @example
   * let mobs = world.getNearbyEntityTypes(bot);
   **/
  const mobs = getNearbyEntities(16);
  const found: string[] = [];
  for (const mob of mobs) {
    if (mob.name && !found.includes(mob.name)) {
      found.push(mob.name);
    }
  }
  return found;
}

export function getNearbyPlayerNames(distance = 32): string[] {
  /**
   * Get a list of all nearby player names.
   * @returns {string[]} - A list of all nearby players.
   * @example
   * let players = world.getNearbyPlayerNames(bot);
   **/
  const players = getNearbyPlayers(distance);
  const found: string[] = [];
  for (const player of players) {
    if (
      player.username &&
      !found.includes(player.username) &&
      player.username !== bot.username
    ) {
      found.push(player.username);
    }
  }
  return found;
}

export function getNearbyBlockTypes(distance: number = 16): string[] {
  /**
   * Get a list of all nearby block names.
   * @param {number} distance - The maximum distance to search, default 16.
   * @returns {string[]} - A list of all nearby blocks.
   * @example
   * let blocks = world.getNearbyBlockTypes(bot);
   **/
  const blocks = getNearestBlocks(null, distance);
  const found: string[] = [];
  for (const block of blocks) {
    if (!found.includes(block.name)) {
      found.push(block.name);
    }
  }
  return found;
}

export async function isClearPath(target: Entity): Promise<boolean> {
  /**
   * Check if there is a path to the target that requires no digging or placing blocks.
   * @param {Entity} target - The target to path to.
   * @returns {boolean} - True if there is a clear path, false otherwise.
   */
  const movements = new Movements(bot);
  movements.canDig = false;
  const goal = new goals.GoalNear(
    target.position.x,
    target.position.y,
    target.position.z,
    1
  );
  const path = await bot.pathfinder.getPathTo(movements, goal, 100);
  return path.status === "success";
}

export function shouldPlaceTorch(): boolean {
  const pos = getPosition();
  // TODO: check light level instead of nearby torches, block.light is broken
  let nearest_torch = getNearestBlock("torch", 10);
  if (!nearest_torch) nearest_torch = getNearestBlock("wall_torch", 10);
  if (!nearest_torch) {
    const block = bot.blockAt(pos);
    const has_torch = bot.inventory
      .items()
      .find((item) => item.name === "torch");
    return !!has_torch && block?.name === "air";
  }
  return false;
}

export function getBiomeName(): string {
  /**
   * Get the name of the biome the bot is in.
   * @returns {string} - The name of the biome.
   * @example
   * let biome = world.getBiomeName(bot);
   **/
  const biomeId = bot.world.getBiome(bot.entity.position);
  return gameData.getAllBiomes()[biomeId].name;
}
