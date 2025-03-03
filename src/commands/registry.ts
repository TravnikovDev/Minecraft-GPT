// Path: src/commands/registry.ts

import { zodFunction } from "openai/helpers/zod";
import * as GoToPlayer from "./GoToPlayer";
// Import other Commands following the same convention
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
import * as GatherWood from "./GatherWood";
import * as CraftWoodenTools from "./CraftWoodenTools";
import * as RandomMovement from "./RandomMovement";
import * as SetBase from "./SetBase";
import * as SetBasement from "./SetBasement";
import * as DigDiagonalTunnel from "./DigDiagonalTunnel";
import * as PickupNearbyItems from "./PickupNearbyItems";
import * as BuildStoneHouse from "./BuildStoneHouse";
import * as FindAndRememberNearChest from "./FindAndRememberNearChest";
import * as ReturnToBase from "./ReturnToBase";
import * as ListInventory from "./ListInventory";
import * as CheckForItem from "./CheckForItem";
import * as DiscardItem from "./DiscardItem";
import * as GiveItemToAPlayer from "./GiveItemToAPlayer";
import * as CraftItem from "./CraftItem";
import * as CraftStoneTools from "./CraftStoneTools";
import * as Stop from "./Stop";
import * as ShowMeBase from "./ShowMeBase";
import * as GoToCoordinates from "./GoToCoordinates";
import * as GoToNamedLocation from "./GoToNamedLocation";
import * as TellLocation from "./TellLocation";
import * as UseNearbyObject from "./UseNearbyObject";
import * as DeployVehicle from "./DeployVehicle";

type CommandModule = {
  parameters: any;
  execute: (args: any) => Promise<void>;
  description: string;
};

// Creating an Command registry by using the filename as a key
export const commandRegistry: Record<BotCommands, CommandModule> = {
  [BotCommands.GoToPlayer]: GoToPlayer,
  [BotCommands.GoToCoordinates]: GoToCoordinates,
  [BotCommands.GoToNamedLocation]: GoToNamedLocation,
  [BotCommands.FollowPlayer]: FollowPlayer,
  [BotCommands.GoToBlock]: GoToBlock,
  [BotCommands.CollectBlocks]: CollectBlocks,
  [BotCommands.AttackNearest]: AttackNearest,
  [BotCommands.DefendSelf]: DefendSelf,
  [BotCommands.Hunting]: Hunting,
  [BotCommands.AvoidEnemies]: AvoidEnemies,
  [BotCommands.EquipBestWeapon]: EquipBestWeapon,
  [BotCommands.Unstack]: Unstack,
  [BotCommands.GatherWood]: GatherWood,
  [BotCommands.CraftItem]: CraftItem,
  [BotCommands.CraftWoodenTools]: CraftWoodenTools,
  [BotCommands.RandomMovement]: RandomMovement,
  [BotCommands.SetBase]: SetBase,
  [BotCommands.SetBasement]: SetBasement,
  [BotCommands.DigDiagonalTunnel]: DigDiagonalTunnel,
  [BotCommands.PickupNearbyItems]: PickupNearbyItems,
  [BotCommands.BuildStoneHouse]: BuildStoneHouse,
  [BotCommands.FindAndRememberNearChest]: FindAndRememberNearChest,
  [BotCommands.ReturnToBase]: ReturnToBase,
  [BotCommands.ListInventory]: ListInventory,
  [BotCommands.CheckForItem]: CheckForItem,
  [BotCommands.DiscardItem]: DiscardItem,
  [BotCommands.GiveItemToAPlayer]: GiveItemToAPlayer,
  [BotCommands.CraftStoneTools]: CraftStoneTools,
  [BotCommands.TellLocation]: TellLocation,
  [BotCommands.UseNearbyObject]: UseNearbyObject,
  [BotCommands.DeployVehicle]: DeployVehicle,
  [BotCommands.Stop]: Stop,
  [BotCommands.ShowMeBase]: ShowMeBase,
};

// Extracting tools for use with validation (zodFunction)
export const availableCommands = Object.entries(commandRegistry).map(
  ([commandName, command]) =>
    zodFunction({
      name: commandName,
      parameters: command.parameters,
      description: command.description,
    })
);
