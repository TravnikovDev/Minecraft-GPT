// Path: src/managers/toolSchemas.ts

import { z } from "zod";

// Define the Zod schemas for each bot action
export const GoToPlayerParameters = z.object({
  player_name: z.string().describe("The name of the player to go to."),
  closeness: z.number().describe("How close to get to the player."),
});

export const FollowPlayerParameters = z.object({
  player_name: z.string().describe("The name of the player to follow."),
  follow_dist: z.number().describe("The distance to follow from."),
});

export const GoToBlockParameters = z.object({
  type: z.string().describe("The block type to go to."),
  closeness: z.number().describe("How close to get to the block."),
  search_range: z.number().describe("The distance to search for the block."),
});

export const CollectBlocksParameters = z.object({
  type: z.string().describe("The block type to collect."),
  num: z.number().describe("The number of blocks to collect."),
});

export const AttackParameters = z.object({
  type: z.string().describe("The type of entity to attack."),
});

export const DefendSelfParameters = z.object({
  range: z
    .number()
    .describe("The range within which to detect and defend against enemies."),
});

export const AvoidEnemiesParameters = z.object({
  distance: z.number().describe("The distance to maintain from enemies."),
});

export const EquipBestWeaponParameters = z.object({});

export const GoToPositionParameters = z.object({
  x: z.number().describe("The x-coordinate to move to."),
  y: z.number().describe("The y-coordinate to move to."),
  z: z.number().describe("The z-coordinate to move to."),
  minDistance: z
    .number()
    .optional()
    .describe("The minimum distance to reach the target position."),
});

export const GoToNearestBlockParameters = z.object({
  blockType: z.string().describe("The type of block to search for."),
  minDistance: z.number().describe("The minimum distance to reach the block."),
  range: z.number().describe("The search range for the block."),
});

export const UseDoorParameters = z.object({
  doorPos: z
    .object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
    })
    .optional()
    .describe("The position of the door to use."),
});

export const HuntingParameters = z.object({});

export const GoToBedParameters = z.object({});
