// Path: src/managers/toolManager.ts

import { zodFunction } from "openai/helpers/zod";
import {
  GoToPlayerParameters,
  FollowPlayerParameters,
  GoToBlockParameters,
  CollectBlocksParameters,
  AttackParameters,
  DefendSelfParameters,
  AvoidEnemiesParameters,
  EquipBestWeaponParameters,
  GoToPositionParameters,
  GoToNearestBlockParameters,
  UseDoorParameters,
  GoToBedParameters,
} from "./toolSchemas";
import { BotActions } from "./actionTypes";
import { bot } from "../index";
import { goals } from "mineflayer-pathfinder";

// Defining tools to use in conjunction with OpenAI's zodFunction for action handling
export const tools = [
  zodFunction({
    name: BotActions.GoToPlayer,
    parameters: GoToPlayerParameters,
  }),
  zodFunction({
    name: BotActions.FollowPlayer,
    parameters: FollowPlayerParameters,
  }),
  zodFunction({ name: BotActions.GoToBlock, parameters: GoToBlockParameters }),
  zodFunction({
    name: BotActions.CollectBlocks,
    parameters: CollectBlocksParameters,
  }),
  zodFunction({ name: BotActions.Attack, parameters: AttackParameters }),
  zodFunction({
    name: BotActions.DefendSelf,
    parameters: DefendSelfParameters,
  }),
  zodFunction({
    name: BotActions.AvoidEnemies,
    parameters: AvoidEnemiesParameters,
  }),
  zodFunction({
    name: BotActions.EquipBestWeapon,
    parameters: EquipBestWeaponParameters,
  }),
  zodFunction({
    name: BotActions.GoToPosition,
    parameters: GoToPositionParameters,
  }),
  zodFunction({
    name: BotActions.GoToNearestBlock,
    parameters: GoToNearestBlockParameters,
  }),
  zodFunction({ name: BotActions.UseDoor, parameters: UseDoorParameters }),
  zodFunction({ name: BotActions.GoToBed, parameters: GoToBedParameters }),
];

// Centralized function to execute a tool action
export async function executeTool(action: string, args: any) {
  console.log(`Executing tool action ${action} with args:`, args);

  // Validate that args contain the expected properties
  if (!args) {
    console.error(`Error: Arguments for action ${action} are undefined.`);
    return;
  }

  switch (action) {
    case BotActions.GoToPlayer: {
      const { player_name, closeness } = GoToPlayerParameters.safeParse(args)
        .success
        ? GoToPlayerParameters.parse(args)
        : {};
      if (!player_name || !closeness) {
        console.error(
          `Missing parameters for GoToPlayer: player_name or closeness is undefined.`
        );
        return;
      }
      const targetPlayer = bot.players[player_name]?.entity;
      if (targetPlayer) {
        bot.pathfinder.setGoal(new goals.GoalFollow(targetPlayer, closeness));
        bot.chat(
          `Heading towards ${player_name}, getting ${closeness} blocks close.`
        );
      } else {
        bot.chat(`Could not find player ${player_name}.`);
      }
      break;
    }
    case BotActions.FollowPlayer: {
      const { player_name, follow_dist } = FollowPlayerParameters.safeParse(
        args
      ).success
        ? FollowPlayerParameters.parse(args)
        : {};
      if (!player_name || !follow_dist) {
        console.error(
          `Missing parameters for FollowPlayer: player_name or follow_dist is undefined.`
        );
        return;
      }
      const targetPlayer = bot.players[player_name]?.entity;
      if (targetPlayer) {
        bot.pathfinder.setGoal(new goals.GoalFollow(targetPlayer, follow_dist));
        bot.chat(
          `Following ${player_name} from a distance of ${follow_dist} blocks.`
        );
      } else {
        bot.chat(`Could not find player ${player_name} to follow.`);
      }
      break;
    }
    case BotActions.GoToBlock: {
      const { type, closeness, search_range } = GoToBlockParameters.safeParse(
        args
      ).success
        ? GoToBlockParameters.parse(args)
        : {};
      if (!type || !closeness || !search_range) {
        console.error(
          `Missing parameters for GoToBlock: type, closeness, or search_range is undefined.`
        );
        return;
      }
      const block = bot.findBlock({
        matching: (block) => block.name === type,
        maxDistance: search_range,
      });
      if (block) {
        bot.pathfinder.setGoal(
          new goals.GoalBlock(
            block.position.x,
            block.position.y,
            block.position.z
          )
        );
        bot.chat(`Heading to ${type} block.`);
      } else {
        bot.chat(
          `Could not find a ${type} block within ${search_range} blocks.`
        );
      }
      break;
    }
    case BotActions.CollectBlocks: {
      const { type, num } = CollectBlocksParameters.safeParse(args).success
        ? CollectBlocksParameters.parse(args)
        : {};
      if (!type || !num) {
        console.error(
          `Missing parameters for CollectBlocks: type or num is undefined.`
        );
        return;
      }
      let collected = 0;
      const timeout = 30000; // 30 seconds timeout
      const listener = (block: { name: any }) => {
        if (block.name === type) {
          collected++;
          bot.chat(`Collected ${collected} of ${type} blocks.`);
          if (collected >= num) {
            bot.chat(`Collected all ${num} ${type} blocks.`);
            bot.removeListener("blockBreakProgressEnd", listener);
          }
        }
      };

      bot.on("blockBreakProgressEnd", listener);

      const block = bot.findBlock({
        matching: (block) => block.name === type,
        maxDistance: 32,
      });

      if (block) {
        bot.dig(block);
      } else {
        bot.chat(`No ${type} blocks found nearby.`);
        bot.removeListener("blockBreakProgressEnd", listener);
      }

      // Set a timeout to remove the listener after a certain period
      setTimeout(() => {
        bot.removeListener("blockBreakProgressEnd", listener);
        bot.chat(`Stopped collecting ${type} blocks due to timeout.`);
      }, timeout);

      break;
    }
    case BotActions.Attack: {
      const { type } = AttackParameters.safeParse(args).success
        ? AttackParameters.parse(args)
        : {};
      if (!type) {
        console.error(`Missing parameters for Attack: type is undefined.`);
        return;
      }
      const targetEntity = bot.nearestEntity(
        (entity) => entity.name === type && entity.type === "mob"
      );
      if (targetEntity) {
        bot.pvp.attack(targetEntity);
        bot.chat(`Attacking ${type}!`);
      } else {
        bot.chat(`No ${type} entities found nearby.`);
      }
      break;
    }
    default: {
      bot.chat(`Action ${action} is not recognized.`);
      break;
    }
  }
}
