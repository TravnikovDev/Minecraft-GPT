// Path: src/commands/registry.ts

import { zodFunction } from "openai/helpers/zod";
import * as GoToPlayer from "./GoToPlayer";
// Import other Commands following the same convention
import * as FollowPlayer from "./FollowPlayer";
import * as GoToBlock from "./GoToBlock";
import * as CollectBlocks from "./CollectBlocks";
import * as AttackNearest from "./AttackNearest";

import { BotCommands } from "./types";
import * as Hunting from "./Hunting";
import * as AvoidEnemies from "./AvoidEnemies";
import * as Unstack from "./Unstack";
import * as EquipBestWeapon from "./EquipBestWeapon";
import * as WearArmor from "./WearArmor";
import * as GatherWood from "./GatherWood";
import * as CraftWoodenTools from "./CraftWoodenTools";
import * as RandomMovement from "./RandomMovement";
import * as SetBase from "./SetBase";
import * as SetBasement from "./SetBasement";
import * as DigDiagonalTunnel from "./DigDiagonalTunnel";
import * as DigToSurface from "./DigToSurface";
import * as StoreItems from "./StoreItems";
import * as TakeFromChest from "./TakeFromChest";
import * as CheckChest from "./CheckChest";
import * as PlantSaplings from "./PlantSaplings";
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
import * as WhereIs from "./WhereIs";
import * as KeepOut from "./KeepOut";
import * as AllowHere from "./AllowHere";
import * as Autonomy from "./Autonomy";
import * as Progress from "./Progress";
import * as DescribeSurroundings from "./DescribeSurroundings";
import * as RecoverItems from "./RecoverItems";
import * as StarterKit from "./StarterKit";
import * as Sleep from "./Sleep";
import * as PlaceItem from "./PlaceItem";
import * as GoByBoat from "./GoByBoat";
import * as Harvest from "./Harvest";
import * as GatherFood from "./GatherFood";
import * as Cook from "./Cook";
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
  [BotCommands.Hunting]: Hunting,
  [BotCommands.AvoidEnemies]: AvoidEnemies,
  [BotCommands.EquipBestWeapon]: EquipBestWeapon,
  [BotCommands.WearArmor]: WearArmor,
  [BotCommands.Unstack]: Unstack,
  [BotCommands.GatherWood]: GatherWood,
  [BotCommands.CraftItem]: CraftItem,
  [BotCommands.CraftWoodenTools]: CraftWoodenTools,
  [BotCommands.RandomMovement]: RandomMovement,
  [BotCommands.SetBase]: SetBase,
  [BotCommands.SetBasement]: SetBasement,
  [BotCommands.DigDiagonalTunnel]: DigDiagonalTunnel,
  [BotCommands.DigToSurface]: DigToSurface,
  [BotCommands.StoreItems]: StoreItems,
  [BotCommands.TakeFromChest]: TakeFromChest,
  [BotCommands.CheckChest]: CheckChest,
  [BotCommands.PlantSaplings]: PlantSaplings,
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
  [BotCommands.WhereIs]: WhereIs,
  [BotCommands.KeepOut]: KeepOut,
  [BotCommands.AllowHere]: AllowHere,
  [BotCommands.Autonomy]: Autonomy,
  [BotCommands.Progress]: Progress,
  [BotCommands.DescribeSurroundings]: DescribeSurroundings,
  [BotCommands.RecoverItems]: RecoverItems,
  [BotCommands.StarterKit]: StarterKit,
  [BotCommands.Sleep]: Sleep,
  [BotCommands.PlaceItem]: PlaceItem,
  [BotCommands.GoByBoat]: GoByBoat,
  [BotCommands.Harvest]: Harvest,
  [BotCommands.GatherFood]: GatherFood,
  [BotCommands.Cook]: Cook,
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
