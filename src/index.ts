import mineflayer from "mineflayer";
import OpenAI from "openai";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { z } from "zod";
import { zodFunction } from "openai/helpers/zod";
import { resolve } from "path";
import { config } from "dotenv";
import { pathfinder, goals } from "mineflayer-pathfinder";
import { plugin as pvp } from "mineflayer-pvp";

// Load environment variables
config();

// Define Bot Settings
const BOT_USERNAME = "MinecraftGPT";
const SERVER_HOST = "localhost";
const SERVER_PORT = 25565;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize OpenAI Client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Define Lowdb schema
const dbSchema = z.object({
  actions: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      priority: z.number(),
    })
  ),
  lore: z.object({ events: z.array(z.string()) }).optional(),
});

// Define the database schema type
type DbSchema = {
  actions: { id: string; action: string; priority: number }[];
  lore?: { events: string[] };
};

// Initialize Lowdb
const dbPath = resolve("db.json");
const adapter = new JSONFile<DbSchema>(dbPath);
const db = new Low<DbSchema>(adapter, { actions: [], lore: { events: [] } });

// Load database
async function loadDb() {
  await db.read();
  db.data ||= { actions: [], lore: { events: [] } };
  await db.write();
}

// Create Bot
const bot = mineflayer.createBot({
  host: SERVER_HOST,
  port: SERVER_PORT,
  username: BOT_USERNAME,
});

// Load Database before starting bot
loadDb();

// Load Plugins
bot.loadPlugin(pathfinder);
bot.loadPlugin(pvp);

// Define an enum for actions
enum BotActions {
  GoToPlayer = "goToPlayer",
  FollowPlayer = "followPlayer",
  GoToBlock = "goToBlock",
  CollectBlocks = "collectBlocks",
  Attack = "attack",
  FightSpider = "fight spider",
  GatherWood = "gather wood",
  Unstack = "unstack",
  DefendSelf = "defend self",
  AvoidEnemies = "avoid enemies",
  EquipBestWeapon = "equip best weapon",
  GoToPosition = "go to position",
  GoToNearestBlock = "go to nearest block",
  UseDoor = "use door",
  GoToBed = "go to bed",
}

// Define tools for ChatGPT
const GoToPlayerParameters = z.object({
  player_name: z.string().describe("The name of the player to go to."),
  closeness: z.number().describe("How close to get to the player."),
});

const FollowPlayerParameters = z.object({
  player_name: z.string().describe("The name of the player to follow."),
  follow_dist: z.number().describe("The distance to follow from."),
});

const GoToBlockParameters = z.object({
  type: z.string().describe("The block type to go to."),
  closeness: z.number().describe("How close to get to the block."),
  search_range: z.number().describe("The distance to search for the block."),
});

const CollectBlocksParameters = z.object({
  type: z.string().describe("The block type to collect."),
  num: z.number().describe("The number of blocks to collect."),
});

const AttackParameters = z.object({
  type: z.string().describe("The type of entity to attack."),
});

const DefendSelfParameters = z.object({
  range: z
    .number()
    .describe("The range within which to detect and defend against enemies."),
});

const AvoidEnemiesParameters = z.object({
  distance: z.number().describe("The distance to maintain from enemies."),
});

const EquipBestWeaponParameters = z.object({});

const GoToPositionParameters = z.object({
  x: z.number().describe("The x-coordinate to move to."),
  y: z.number().describe("The y-coordinate to move to."),
  z: z.number().describe("The z-coordinate to move to."),
  minDistance: z
    .number()
    .default(2)
    .describe("The minimum distance to reach the target position."),
});

const GoToNearestBlockParameters = z.object({
  blockType: z.string().describe("The type of block to search for."),
  minDistance: z
    .number()
    .default(2)
    .describe("The minimum distance to reach the block."),
  range: z.number().default(64).describe("The search range for the block."),
});

const UseDoorParameters = z.object({
  doorPos: z
    .object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
    })
    .optional()
    .describe("The position of the door to use."),
});

const GoToBedParameters = z.object({});

const tools = [
  zodFunction({
    name: BotActions.GoToPlayer,
    parameters: GoToPlayerParameters,
  }),
  zodFunction({
    name: BotActions.FollowPlayer,
    parameters: FollowPlayerParameters,
  }),
  zodFunction({ name: BotActions.GoToBlock, parameters: GoToBlockParameters }),
  zodFunction({
    name: BotActions.CollectBlocks,
    parameters: CollectBlocksParameters,
  }),
  zodFunction({ name: BotActions.Attack, parameters: AttackParameters }),
  zodFunction({
    name: BotActions.DefendSelf,
    parameters: DefendSelfParameters,
  }),
  zodFunction({
    name: BotActions.AvoidEnemies,
    parameters: AvoidEnemiesParameters,
  }),
  zodFunction({
    name: BotActions.EquipBestWeapon,
    parameters: EquipBestWeaponParameters,
  }),
  zodFunction({
    name: BotActions.GoToPosition,
    parameters: GoToPositionParameters,
  }),
  zodFunction({
    name: BotActions.GoToNearestBlock,
    parameters: GoToNearestBlockParameters,
  }),
  zodFunction({ name: BotActions.UseDoor, parameters: UseDoorParameters }),
  zodFunction({ name: BotActions.GoToBed, parameters: GoToBedParameters }),
];

// Event: Bot spawned
bot.once("spawn", () => {
  bot.chat("Hello world! Minecraft-gpt at your service!");
});

// Event: Player chat interaction
bot.on("chat", async (username, message) => {
  if (username === bot.username) return;

  const openAiResponse = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content:
          "You are a helpful Minecraft assistant. Use the supplied tools to assist the user.",
      },
      { role: "user", content: message },
    ],
    tools: tools,
  });

  const response = openAiResponse.choices[0].message?.content;
  const toolCall = openAiResponse.choices[0].message?.tool_calls?.[0].function;

  if (response) bot.chat(response);
  if (toolCall) {
    switch (toolCall.name) {
      case BotActions.GoToPlayer: {
        let parsedArguments;
        try {
          parsedArguments = GoToPlayerParameters.parse(
            JSON.parse(toolCall.arguments)
          );
        } catch (error) {
          bot.chat("Failed to parse arguments.");
          console.error(error);
          return;
        }
        const { player_name, closeness } = parsedArguments;
        bot.chat(
          `Heading towards ${player_name}, getting ${closeness} blocks close.`
        );
        // Implement movement logic here
        const targetPlayer = bot.players[player_name]?.entity;
        if (targetPlayer) {
          bot.pathfinder.setGoal(new goals.GoalFollow(targetPlayer, closeness));
        } else {
          bot.chat(`Could not find player ${player_name}.`);
        }
        break;
      }
      case BotActions.FollowPlayer: {
        const parsedArguments = FollowPlayerParameters.parse(
          toolCall.arguments
        );
        const { player_name, follow_dist } = parsedArguments;
        bot.chat(
          `Following ${player_name} from a distance of ${follow_dist} blocks.`
        );
        // Implement follow logic here
        const targetPlayer = bot.players[player_name]?.entity;
        if (targetPlayer) {
          bot.chat(`Found player ${player_name}, starting to follow.`);
          bot.pathfinder.setGoal(
            new goals.GoalFollow(targetPlayer, follow_dist)
          );
        } else {
          bot.chat(`Could not find player ${player_name} to follow.`);
        }
        break;
      }
      case BotActions.GoToBlock: {
        const parsedArguments = GoToBlockParameters.parse(toolCall.arguments);
        const { type, closeness, search_range } = parsedArguments;
        bot.chat(
          `Searching for ${type} block within ${search_range} blocks, getting ${closeness} blocks close.`
        );
        // Implement block search logic here
        const block = bot.findBlock({
          matching: (block) => block.name === type,
          maxDistance: search_range,
        });
        if (block) {
          bot.chat(`Found ${type} block, moving to it.`);
          bot.pathfinder.setGoal(
            new goals.GoalBlock(
              block.position.x,
              block.position.y,
              block.position.z
            )
          );
        } else {
          bot.chat(
            `Could not find a ${type} block within ${search_range} blocks.`
          );
        }
        break;
      }
      case BotActions.CollectBlocks: {
        const parsedArguments = CollectBlocksParameters.parse(
          toolCall.arguments
        );
        const { type, num } = parsedArguments;
        bot.chat(`Collecting ${num} of ${type} blocks.`);
        // Implement block collection logic here
        let collected = 0;
        bot.on("blockBreakProgressEnd", (block) => {
          if (block.name === type) {
            collected++;
            bot.chat(`Collected ${collected} of ${type} blocks.`);
            if (collected >= num) {
              bot.chat(`Collected all ${num} ${type} blocks.`);
              bot.removeAllListeners("blockBreakProgressEnd");
            }
          }
        });
        const block = bot.findBlock({
          matching: (block) => block.name === type,
          maxDistance: 32,
        });
        if (block) {
          bot.dig(block);
        } else {
          bot.chat(`No ${type} blocks found nearby.`);
        }
        break;
      }
      case BotActions.Attack: {
        const parsedArguments = AttackParameters.parse(toolCall.arguments);
        const { type } = parsedArguments;
        bot.chat(`Attacking entity of type ${type}.`);
        // Implement attack logic here
        const targetEntity = bot.nearestEntity(
          (entity) => entity.name === type && entity.type === "mob"
        );
        if (targetEntity) {
          bot.chat(`Attacking ${type}!`);
          bot.pvp.attack(targetEntity);
        } else {
          bot.chat(`No ${type} entities found nearby.`);
        }
        break;
      }
      default:
        bot.chat(`Received an unknown command: ${toolCall.name}`);
        break;
    }
  }

  // Add command to action stack for processing
  db.data?.actions.push({
    id: String(Date.now()),
    action: response || "No response",
    priority: 3,
  });
  await db.write();
});

// Event: Entity spawning or detection
bot.on("entitySpawn", (entity) => {
  if (entity.name === "spider") {
    bot.chat("Spider detected! I am ready for battle!");
    db.data?.actions.push({
      id: String(Date.now()),
      action: BotActions.FightSpider,
      priority: 1,
    });
    db.write();
  }
});

// Idle behavior: Always keep the bot busy
setInterval(async () => {
  if (db.data?.actions.length === 0) {
    // If no actions, gather resources
    bot.chat("No tasks right now. I will gather some wood.");
    db.data?.actions.push({
      id: String(Date.now()),
      action: BotActions.GatherWood,
      priority: 5,
    });
    await db.write();
  }

  // Execute the highest priority action
  const nextAction = db.data?.actions.sort(
    (a, b) => a.priority - b.priority
  )[0];
  if (nextAction) {
    performAction(nextAction.action);
    db.data!.actions = db.data!.actions.filter(
      (action) => action.id !== nextAction.id
    );
    await db.write();
  }
}, 5000);

// Function to perform specific actions
function performAction(action: string) {
  switch (action.toLowerCase()) {
    case BotActions.FightSpider:
      bot.chat("Engaging in combat!");
      // Additional combat logic here
      const spider = bot.nearestEntity(
        (entity) => entity.name === "spider" && entity.type === "mob"
      );
      if (spider) {
        bot.pvp.attack(spider);
      } else {
        bot.chat("No spider found to attack.");
      }
      break;
    case BotActions.GatherWood:
      bot.chat("Heading out to gather wood.");
      // Gathering logic here
      const woodBlock = bot.findBlock({
        matching: (block) => block.name.includes("log"),
        maxDistance: 32,
      });
      if (woodBlock) {
        bot.pathfinder.setGoal(
          new goals.GoalBlock(
            woodBlock.position.x,
            woodBlock.position.y,
            woodBlock.position.z
          )
        );
        bot.once("goal_reached", () => {
          bot.dig(woodBlock);
        });
      } else {
        bot.chat("No wood blocks found nearby.");
      }
      break;
    default:
      bot.chat(`Performing action: ${action}`);
      break;
  }
}
