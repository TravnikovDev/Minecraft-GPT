// Path: src/actions/registry.ts

import { zodFunction } from "openai/helpers/zod";
import * as GoToPlayer from "./GoToPlayer";
// Import other actions following the same convention
import * as FollowPlayer from "./FollowPlayer";
import * as GoToBlock from "./GoToBlock";
import * as CollectBlocks from "./CollectBlocks";
import * as AttackNearest from "./AttackNearest";
import * as DefendSelf from "./DefendSelf";

import { BotActions } from "./types";
import * as Hunting from "./Hunting";
import * as AvoidEnemies from "./AvoidEnemies";
import * as Unstack from "./Unstack";
import * as EquipBestWeapon from "./EquipBestWeapon";
import * as GoToPosition from "./GoToPosition";
import * as GoToNearestBlock from "./GoToNearestBlock";
import * as GatherWood from "./GatherWood";
import * as CraftWoodenTools from "./CraftWoodenTools";
import * as RandomMovement from "./RandomMovement";
import * as EvaluateBaseLocation from "./EvaluateBaseLocation";
import * as SetBaseLocation from "./SetBaseLocation";
import * as SetBasement from "./SetBasement";
import * as DigDiagonalTunnel from "./DigDiagonalTunnel";
import * as PickupNearbyItems from "./PickupNearbyItems";
import * as BuildStoneHouse from "./BuildStoneHouse";
import * as BuildBridge from "./BuildBridge";
import * as CraftBackupTools from "./CraftBackupTools";
import * as FindAndRememberNearChest from "./FindAndRememberNearChest";
import * as ReturnToBase from "./ReturnToBase";

type ActionModule = {
  parameters: any;
  execute: (args: any) => Promise<void>;
  description: string;
};

// Creating an action registry by using the filename as a key
export const actionRegistry: Record<BotActions, ActionModule> = {
  [BotActions.GoToPlayer]: GoToPlayer,
  [BotActions.FollowPlayer]: FollowPlayer,
  [BotActions.GoToBlock]: GoToBlock,
  [BotActions.CollectBlocks]: CollectBlocks,
  [BotActions.AttackNearest]: AttackNearest,
  [BotActions.DefendSelf]: DefendSelf,
  [BotActions.Hunting]: Hunting,
  [BotActions.AvoidEnemies]: AvoidEnemies,
  [BotActions.EquipBestWeapon]: EquipBestWeapon,
  [BotActions.GoToPosition]: GoToPosition,
  [BotActions.GoToNearestBlock]: GoToNearestBlock,
  [BotActions.Unstack]: Unstack,
  [BotActions.GatherWood]: GatherWood,
  [BotActions.CraftWoodenTools]: CraftWoodenTools,
  [BotActions.RandomMovement]: RandomMovement,
  [BotActions.EvaluateBaseLocation]: EvaluateBaseLocation,
  [BotActions.SetBaseLocation]: SetBaseLocation,
  [BotActions.SetBasement]: SetBasement,
  [BotActions.DigDiagonalTunnel]: DigDiagonalTunnel,
  [BotActions.PickupNearbyItems]: PickupNearbyItems,
  [BotActions.BuildStoneHouse]: BuildStoneHouse,
  [BotActions.BuildBridge]: BuildBridge,
  [BotActions.CraftBackupTools]: CraftBackupTools,
  [BotActions.FindAndRememberNearChest]: FindAndRememberNearChest,
  [BotActions.ReturnToBase]: ReturnToBase,
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
