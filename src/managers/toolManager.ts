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
