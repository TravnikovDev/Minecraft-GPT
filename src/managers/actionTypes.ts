// Path: src/managers/actionTypes.ts

// Define an enum for available bot actions
enum BotActions {
  GoToPlayer = "goToPlayer",
  FollowPlayer = "followPlayer",
  GoToBlock = "goToBlock",
  CollectBlocks = "collectBlocks",
  Attack = "attack",
  FightSpider = "fightSpider",
  GatherWood = "gatherWood",
  DefendSelf = "defendSelf",
  AvoidEnemies = "avoidEnemies",
  EquipBestWeapon = "equipBestWeapon",
  GoToPosition = "goToPosition",
  GoToNearestBlock = "goToNearestBlock",
  UseDoor = "useDoor",
  GoToBed = "goToBed",
  Unstack = "unstack",
}

// Type guard to check if a value is a valid BotActions
function isBotAction(action: string): action is BotActions {
  return Object.values(BotActions).includes(action as BotActions);
}

export { BotActions, isBotAction };
