// Path: src/commands/types.ts

// Define an enum for available bot actions
enum BotCommands {
  GoToPlayer = "goToPlayer",
  FollowPlayer = "followPlayer",
  GoToBlock = "goToBlock",
  CollectBlocks = "collectBlocks",
  AttackNearest = "attackNearest",
  DefendSelf = "defendSelf",
  Hunting = "hunting",
  AvoidEnemies = "avoidEnemies",
  EquipBestWeapon = "equipBestWeapon",
  GoToPosition = "goToPosition",
  Unstack = "unstack",
  GatherWood = "gatherWood",
  CraftWoodenTools = "craftWoodenTools",
  RandomMovement = "randomMovement",
  EvaluateBaseLocation = "evaluateBaseLocation",
  SetBaseLocation = "setBaseLocation",
  SetBasement = "setBasement",
  DigDiagonalTunnel = "digDiagonalTunnel",
  PickupNearbyItems = "pickupNearbyItems",
  BuildStoneHouse = "buildStoneHouse",
  FindAndRememberNearChest = "findAndRememberNearChest",
  ReturnToBase = "returnToBase",
  ListInventory = "listInventory",
  CheckForItem = "checkForItem",
}

// Type guard to check if a value is a valid BotCommands
function isBotAction(action: string): action is BotCommands {
  return Object.values(BotCommands).includes(action as BotCommands);
}

export { BotCommands, isBotAction };
