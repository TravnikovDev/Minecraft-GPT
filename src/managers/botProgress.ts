// Path: src/managers/botProgress.ts

import { bot } from "..";
import { getInventory, getBotProgress, saveBotProgress } from "./persistenceManager";
import { getItemCraftingRecipes } from "../utils/minecraftData";

// Define crafting tiers for progression
interface CraftingTier {
  level: number;
  description: string;
  requiredItems: string[];  // Key items that unlock this tier
  unlockedRecipes: string[];  // Recipes unlocked at this tier
}

// Minecraft-like progression tiers that unlock recipes
const craftingTiers: CraftingTier[] = [
  { 
    level: 1, 
    description: "Basic Survival",
    requiredItems: [], // Already unlocked
    unlockedRecipes: ["crafting_table", "wooden_planks", "stick", "wooden_pickaxe"]
  },
  { 
    level: 2, 
    description: "Stone Tools",
    requiredItems: ["cobblestone", "crafting_table"],
    unlockedRecipes: ["stone_pickaxe", "stone_axe", "stone_shovel", "furnace"]
  },
  { 
    level: 3, 
    description: "Iron Working",
    requiredItems: ["iron_ingot", "furnace"],
    unlockedRecipes: ["iron_pickaxe", "iron_axe", "iron_shovel", "shield", "bucket"]
  },
  { 
    level: 4, 
    description: "Advanced Construction",
    requiredItems: ["iron_ingot", "planks", "glass"],
    unlockedRecipes: ["chest", "piston", "hopper", "daylight_detector"] 
  },
  { 
    level: 5, 
    description: "Diamond Tools",
    requiredItems: ["diamond"],
    unlockedRecipes: ["diamond_pickaxe", "diamond_axe", "diamond_shovel", "enchanting_table"] 
  },
  { 
    level: 6, 
    description: "Nether Exploration",
    requiredItems: ["obsidian", "flint_and_steel"],
    unlockedRecipes: ["fire_charge", "brewing_stand", "end_crystal"] 
  }
];

// Bot Progress Tracking
export class BotProgress {
  private currentLevel: number;
  private craftableTier: number;
  private recipeCache: Map<string, boolean>;
  private unlockedRecipes: Set<string>;

  constructor() {
    // Load saved progress from database
    const savedProgress = getBotProgress();
    
    this.currentLevel = savedProgress.currentLevel;
    this.craftableTier = savedProgress.craftableTier;
    this.recipeCache = new Map<string, boolean>();
    this.unlockedRecipes = new Set<string>(savedProgress.unlockedRecipes);
    
    console.log(`Loaded bot progress: Level ${this.currentLevel}, Tier ${this.craftableTier}`);
    console.log(`Bot knows ${this.unlockedRecipes.size} recipes`);
    
    // Initialize recipes for current tier if none were loaded
    if (this.unlockedRecipes.size === 0) {
      this.initializeRecipesForCurrentTier();
    }
    
    // Start periodically checking for new recipe unlocks
    setInterval(() => this.checkRecipeProgression(), 30000); // Check every 30 seconds
  }
  
  // Initialize recipes for current tier
  private initializeRecipesForCurrentTier(): void {
    for (let tier = 1; tier <= this.craftableTier; tier++) {
      const tierData = craftingTiers.find(t => t.level === tier);
      if (tierData) {
        tierData.unlockedRecipes.forEach(recipe => this.unlockedRecipes.add(recipe));
      }
    }
    
    // Save initial state
    this.saveProgress();
  }

  // Check if the bot has gathered the required items to progress to the next tier
  private async checkRecipeProgression(): Promise<void> {
    try {
      const inventory = getInventory();
      const currentTier = craftingTiers.find(tier => tier.level === this.craftableTier);
      
      if (!currentTier) return;
      
      // Check if we can advance to the next tier
      const nextTier = craftingTiers.find(tier => tier.level === this.craftableTier + 1);
      if (!nextTier) return; // Already at max tier
      
      // Check if the bot has all required items to advance
      const hasRequiredItems = nextTier.requiredItems.every(itemName => {
        return inventory.some(item => item.name === itemName && item.count > 0);
      });
      
      if (hasRequiredItems) {
        this.craftableTier++;
        console.log(`Bot has advanced to crafting tier ${this.craftableTier}: ${nextTier.description}`);
        
        // Add new recipes to the unlocked set
        nextTier.unlockedRecipes.forEach(recipe => this.unlockedRecipes.add(recipe));
        console.log(`Unlocked new recipes: ${nextTier.unlockedRecipes.join(", ")}`);
        
        // Clear recipe cache when advancing tiers
        this.recipeCache.clear();
        
        // Save progress to database
        this.saveProgress();
        
        // This would be a good place to announce new recipes to the player
        bot.chat(`I've learned how to craft ${nextTier.unlockedRecipes.length} new items!`);
      }
    } catch (error) {
      console.error("Error checking recipe progression:", error);
    }
  }

  // Save progress to the database
  private async saveProgress(): Promise<void> {
    await saveBotProgress({
      currentLevel: this.currentLevel,
      craftableTier: this.craftableTier,
      unlockedRecipes: Array.from(this.unlockedRecipes)
    });
  }

  // Check if the bot can craft a specific item based on current tier
  public canCraftItem(itemName: string): boolean {
    // Check cache first
    if (this.recipeCache.has(itemName)) {
      return this.recipeCache.get(itemName) || false;
    }
    
    // Basic validation - check if recipe exists at all
    const recipes = getItemCraftingRecipes(itemName);
    if (!recipes || recipes.length === 0) {
      this.recipeCache.set(itemName, false);
      return false;
    }
    
    // Check if this item is in our unlocked recipes
    const isCraftable = this.unlockedRecipes.has(itemName);
    
    // Cache the result
    this.recipeCache.set(itemName, isCraftable);
    return isCraftable;
  }

  // Check if the bot's inventory shows it can progress to a higher tier
  public async updateTierBasedOnInventory(): Promise<void> {
    const inventory = getInventory();
    let progressUpdated = false;
    
    // Check each tier above current tier
    for (let nextLevel = this.craftableTier + 1; nextLevel <= craftingTiers.length; nextLevel++) {
      const nextTier = craftingTiers.find(tier => tier.level === nextLevel);
      if (!nextTier) continue;
      
      // Check if the bot has all required items
      const hasRequiredItems = nextTier.requiredItems.every(itemName => {
        return inventory.some(item => item.name === itemName && item.count > 0);
      });
      
      if (hasRequiredItems) {
        this.craftableTier = nextLevel;
        
        // Add new recipes to the unlocked set
        nextTier.unlockedRecipes.forEach(recipe => this.unlockedRecipes.add(recipe));
        
        progressUpdated = true;
        console.log(`Bot has advanced to crafting tier ${this.craftableTier}: ${nextTier.description}`);
        
        // Clear recipe cache
        this.recipeCache.clear();
      } else {
        // Stop checking once we hit a tier we can't advance to
        break;
      }
    }
    
    // Save progress if it was updated
    if (progressUpdated) {
      await this.saveProgress();
    }
  }

  // For compatibility with original level system
  public async attemptLevelUp(): Promise<void> {
    // We're using crafting tiers instead, so just ensure tier is updated
    await this.updateTierBasedOnInventory();
    
    // Map crafting tier to level (they can be different concepts)
    if (this.craftableTier > this.currentLevel) {
      this.currentLevel = this.craftableTier;
      // Save the updated level
      await this.saveProgress();
    }
  }
  
  // Get crafting tier
  public getCraftingTier(): number {
    return this.craftableTier;
  }

  // Get current level
  public getCurrentLevel(): number {
    return this.currentLevel;
  }
  
  // Get list of recipes available at current tier
  public getAvailableRecipes(): string[] {
    return Array.from(this.unlockedRecipes);
  }
  
  // Get a list of items needed to unlock the next tier
  public getNextTierRequirements(): string[] {
    const nextTier = craftingTiers.find(tier => tier.level === this.craftableTier + 1);
    return nextTier ? nextTier.requiredItems : [];
  }
}
