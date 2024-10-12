// Path: src/commands/registry.ts

import { zodFunction } from "openai/helpers/zod";
import * as GoToPlayer from "./GoToPlayer";
// Import other actions following the same convention
import * as FollowPlayer from "./FollowPlayer";
import * as GoToBlock from "./GoToBlock";
import * as CollectBlocks from "./CollectBlocks";
import * as AttackNearest from "./AttackNearest";
import * as DefendSelf from "./DefendSelf";

import { BotCommands } from "./types";
import * as Hunting from "./Hunting";
import * as AvoidEnemies from "./AvoidEnemies";
import * as Unstack from "./Unstack";
import * as EquipBestWeapon from "./EquipBestWeapon";
import * as GoToPosition from "./GoToPosition";
import * as GatherWood from "./GatherWood";
import * as CraftWoodenTools from "./CraftWoodenTools";
import * as RandomMovement from "./RandomMovement";
import * as EvaluateBaseLocation from "./EvaluateBaseLocation";
import * as SetBaseLocation from "./SetBaseLocation";
import * as SetBasement from "./SetBasement";
import * as DigDiagonalTunnel from "./DigDiagonalTunnel";
import * as PickupNearbyItems from "./PickupNearbyItems";
import * as BuildStoneHouse from "./BuildStoneHouse";
import * as FindAndRememberNearChest from "./FindAndRememberNearChest";
import * as ReturnToBase from "./ReturnToBase";

type ActionModule = {
  parameters: any;
  execute: (args: any) => Promise<void>;
  description: string;
};

// Creating an action registry by using the filename as a key
export const actionRegistry: Record<BotCommands, ActionModule> = {
  [BotCommands.GoToPlayer]: GoToPlayer,
  [BotCommands.FollowPlayer]: FollowPlayer,
  [BotCommands.GoToBlock]: GoToBlock,
  [BotCommands.CollectBlocks]: CollectBlocks,
  [BotCommands.AttackNearest]: AttackNearest,
  [BotCommands.DefendSelf]: DefendSelf,
  [BotCommands.Hunting]: Hunting,
  [BotCommands.AvoidEnemies]: AvoidEnemies,
  [BotCommands.EquipBestWeapon]: EquipBestWeapon,
  [BotCommands.GoToPosition]: GoToPosition,
  [BotCommands.Unstack]: Unstack,
  [BotCommands.GatherWood]: GatherWood,
  [BotCommands.CraftWoodenTools]: CraftWoodenTools,
  [BotCommands.RandomMovement]: RandomMovement,
  [BotCommands.EvaluateBaseLocation]: EvaluateBaseLocation,
  [BotCommands.SetBaseLocation]: SetBaseLocation,
  [BotCommands.SetBasement]: SetBasement,
  [BotCommands.DigDiagonalTunnel]: DigDiagonalTunnel,
  [BotCommands.PickupNearbyItems]: PickupNearbyItems,
  [BotCommands.BuildStoneHouse]: BuildStoneHouse,
  [BotCommands.FindAndRememberNearChest]: FindAndRememberNearChest,
  [BotCommands.ReturnToBase]: ReturnToBase,
};

// Extracting tools for use with validation (zodFunction)
export const availableActions = Object.entries(actionRegistry).map(
  ([actionName, action]) =>
    zodFunction({
      name: actionName,
      parameters: action.parameters,
      description: action.description,
    })
);
