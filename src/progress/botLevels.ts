// Bot Progress Levels
interface ProgressLevel {
  level: number;
  description: string;
  requiredItems: { name: string; count: number }[]; // Items needed to unlock the next level
}

// Levels Definition
export const botLevels: ProgressLevel[] = [
  {
    level: 1,
    description: "Basic Survival - Gather Wood and Craft Basic Tools",
    requiredItems: [],
  },
  {
    level: 2,
    description: "Shelter Construction and Advanced Gathering",
    requiredItems: [
      { name: "planks", count: 20 },
      { name: "cobblestone", count: 30 },
    ],
    // requiredTasks: ["gather_stone", "craft_stone_tools"],
  },
  //   {
  //     level: 3,
  //     description: "Mining and Iron Tools",
  //     requiredItems: [
  //       { name: "cobblestone", count: 30 },
  //       { name: "iron_ore", count: 20 },
  //     ],
  //     requiredTasks: ["mine_iron", "smelt_iron", "craft_iron_tools"],
  //   },
  //   {
  //     level: 4,
  //     description: "Farming and Food Security",
  //     requiredItems: [
  //       { name: "iron_ingot", count: 10 },
  //       { name: "wheat_seeds", count: 20 },
  //     ],
  //     requiredTasks: ["set_up_farm", "grow_wheat", "collect_food"],
  //   },
  // Further levels can be added here
];
