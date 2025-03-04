// Path: src/managers/botProgress.ts

import { getInventory } from "./persistenceManager";
import { botLevels } from "../progress/botLevels";

// Bot Progress Tracking
export class BotProgress {
  private currentLevel: number;

  constructor() {
    this.currentLevel = 1;
  }

  // Check if the bot can level up
  public async attemptLevelUp(): Promise<void> {
    const inventory = getInventory();

    const currentLevelConfig = botLevels.find(
      (level) => level.level === this.currentLevel
    );
    if (!currentLevelConfig) return;

    // Check if required items are present in the inventory
    const hasRequiredItems = this.hasAllRequiredItems(
      currentLevelConfig.requiredItems,
      inventory
    );

    // Check if required tasks are completed
    /* const hasCompletedTasks = currentLevelConfig.requiredTasks.every((task) =>
      checkTaskCompletion(task.id)
    ); */

    /* if (hasRequiredItems && hasCompletedTasks) {
      this.currentLevel++;
      console.log(`Bot leveled up to Level ${this.currentLevel}!`);

      // Hook or callback for additional actions when leveling up
      await this.onLevelUp();

      // Unlock new tasks for the bot
      const nextLevelConfig = botLevels.find(
        (level) => level.level === this.currentLevel
      );
      if (nextLevelConfig) {
        for (const task of nextLevelConfig.requiredTasks) {
          try {
            await addTask(task);
          } catch (error) {
            console.error(`Error adding task ${task}:`, error);
          }
        }
      }
    } */
  }

  // Function to check if all required items are present in the inventory
  private hasAllRequiredItems(
    requiredItems: { name: string; count: number }[],
    inventory: { name: string; count: number }[]
  ): boolean {
    return requiredItems.every((item) => {
      const inventoryItem = inventory.find((inv) => inv.name === item.name);
      return inventoryItem && inventoryItem.count >= item.count;
    });
  }

  // Hook or callback for additional actions when leveling up
  private async onLevelUp(): Promise<void> {
    console.log(
      `Additional actions triggered for Level ${this.currentLevel} upgrade.`
    );
  }

  // Get current level
  public getCurrentLevel(): number {
    return this.currentLevel;
  }
}
