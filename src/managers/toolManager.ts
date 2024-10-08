// Path: src/managers/toolManager.ts

import {
  GoToPlayerParameters,
  FollowPlayerParameters,
  GoToBlockParameters,
  CollectBlocksParameters,
  AttackParameters,
  DefendSelfParameters,
} from "./toolSchemas";
import { BotActions } from "./actionTypes";
import { bot } from "../index";
import { goals } from "mineflayer-pathfinder";

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
        bot.pathfinder.setGoal(
          new goals.GoalNear(
            targetPlayer.position.x,
            targetPlayer.position.y,
            targetPlayer.position.z,
            closeness
          )
        );
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
    case BotActions.Hunting: {
      const huntable = bot.nearestEntity((entity) => entity.type === "mob");
      if (huntable) {
        bot.pvp.attack(huntable);
        bot.chat(`Hunting ${huntable.name}!`);
      } else {
        bot.chat(`No huntable animals nearby.`);
      }
      break;
    }
    case BotActions.DefendSelf: {
      const { range } = DefendSelfParameters.safeParse(args).success
        ? DefendSelfParameters.parse(args)
        : {};
      if (!range) {
        console.error(`Missing parameters for DefendSelf: range is undefined.`);
        return;
      }
      const hostileEntity = bot.nearestEntity(
        (entity) => entity.type === "mob" && entity.mobType === "hostile"
      );
      if (
        hostileEntity &&
        hostileEntity.position.distanceTo(bot.entity.position) <= range
      ) {
        bot.pvp.attack(hostileEntity);
        bot.chat(`Defending myself against ${hostileEntity.name}!`);
      } else {
        bot.chat(`No hostile entities within range.`);
      }
      break;
    }
    default: {
      bot.chat(`Action ${action} is not recognized.`);
      break;
    }
  }
}
