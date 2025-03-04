// Path: src/commands/types.ts

// Define an enum for available bot actions
enum BotCommands {
  GoToPlayer = "goToPlayer",
  GoToCoordinates = "goToCoordinates",
  GoToNamedLocation = "goToNamedLocation",
  FollowPlayer = "followPlayer",
  GoToBlock = "goToBlock",
  CollectBlocks = "collectBlocks",
  AttackNearest = "attackNearest",
  DefendSelf = "defendSelf",
  Hunting = "hunting",
  AvoidEnemies = "avoidEnemies",
  EquipBestWeapon = "equipBestWeapon",
  Unstack = "unstack",
  GatherWood = "gatherWood",
  CraftItem = "craftItem",
  CraftWoodenTools = "craftWoodenTools",
  CraftStoneTools = "craftStoneTools",
  RandomMovement = "randomMovement",
  SetBase = "SetBase",
  SetBasement = "setBasement",
  DigDiagonalTunnel = "digDiagonalTunnel",
  PickupNearbyItems = "pickupNearbyItems",
  BuildStoneHouse = "buildStoneHouse",
  FindAndRememberNearChest = "findAndRememberNearChest",
  ReturnToBase = "returnToBase",
  ListInventory = "listInventory",
  CheckForItem = "checkForItem",
  DiscardItem = "discardItem",
  GiveItemToAPlayer = "giveItemToAPlayer",
  TellLocation = "tellLocation",
  UseNearbyObject = "useNearbyObject",
  DeployVehicle = "deployVehicle",
  Stop = "stop",
  ShowMeBase = "showMeBase",
}

// Type guard to check if a value is a valid BotCommands
function isBotAction(action: string): action is BotCommands {
  return Object.values(BotCommands).includes(action as BotCommands);
}

export { BotCommands, isBotAction };
