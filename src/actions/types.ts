// Path: src/actions/types.ts

// Define an enum for available bot actions
enum BotActions {
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
  GoToNearestBlock = "goToNearestBlock",
  Unstack = "unstack",
  GatherWood = "gatherWood",
  CraftWoodenTools = "craftWoodenTools",
  RandomMovement = "randomMovement",
  EvaluateBaseLocation = "evaluateBaseLocation",
  SetBaseLocation = "setBaseLocation",
  SetBasement = "setBasement",
  DigDiagonalTunnel = "digDiagonalTunnel",
}

// Type guard to check if a value is a valid BotActions
function isBotAction(action: string): action is BotActions {
  return Object.values(BotActions).includes(action as BotActions);
}

export { BotActions, isBotAction };
