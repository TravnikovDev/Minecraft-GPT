// Path: src/managers/aiManager.ts

import OpenAI from "openai";
import { OPENAI_API_KEY } from "../config/env";
import { bot } from "../core/body";
import { BotCommands, isBotAction } from "../commands/types";
import { executeTool, tools } from "./toolManager";
import { addCommandToQueue } from "./persistenceManager";
import { cancelCurrentCommand, getCurrentCommandName, stopEverything } from "./actionManager";
import { normalizeMinecraftName } from "../utils/utility";
import { directionFromOwner, ownerDistance } from "./ownerDialog";
import { recentConversation } from "../core/session";

// Questions answered from current state: they run immediately, even while the
// bot is busy with something else, instead of waiting in the queue
const INSTANT_COMMANDS = new Set<string>([
  BotCommands.TellLocation,
  BotCommands.ListInventory,
  BotCommands.CheckForItem,
  BotCommands.DescribeSurroundings,
]);

// Requests that should interrupt the running task instead of waiting behind it:
// the owner calling the bot, or telling it that it is stuck
const INTERRUPTING_COMMANDS = new Set<string>([
  BotCommands.Unstack,
  BotCommands.GoToPlayer,
  BotCommands.FollowPlayer,
  BotCommands.GoToCoordinates,
  BotCommands.GoByBoat,
]);

/** One line of real state for the model, so its chat answers are grounded. */
function stateLine(): string {
  const pos = bot.entity?.position;
  const where = pos ? `${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}` : "unknown";
  const dist = ownerDistance();
  const owner = dist === null ? "not visible" : `${Math.round(dist)} blocks away (bot is ${directionFromOwner()} of owner)`;
  const task = getCurrentCommandName() ?? "idle";
  const held = bot.heldItem?.name ?? "nothing";
  return `[bot state: at ${where}; owner ${owner}; current task ${task}; holding ${held}; health ${Math.round(bot.health ?? 0)}/20, food ${bot.food ?? 0}/20]`;
}

// Initialize OpenAI Client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const setupMessage = `You are MinecraftGPT, a bot playing Minecraft together with the players who chat with you.
Talk like a friendly, enthusiastic 12-year-old who loves Minecraft and wants to play along.

How to respond:
- When a player asks you to do something in the game, call the one tool that best matches the request.
- Use exact Minecraft IDs for items, blocks and mobs, e.g. oak_log, oak_planks, cobblestone, zombie.
- When you just talk, reply in plain text: one or two short sentences.
- Never put JSON, code or markdown in your reply; it is shown as-is in Minecraft chat.
- If a request is unclear or no tool fits, ask a short clarifying question.
- Earlier messages are your recent conversation with the player (your past replies include results like "Crafted 1 stone pickaxe"). Use them to understand follow-ups such as "do that again", "no, the other one" or "let's start from the beginning".`;

// Argument names that hold Minecraft item, block or mob IDs
const MINECRAFT_ID_ARGS = new Set(["itemName", "item_name", "blockType", "mobType"]);

interface ToolCallType {
  name: string;
  arguments: string;
}

interface ToolActionType {
  action: string;
  arguments: any;
}

interface HandleResponseType {
  response: string | null;
  toolCall: ToolCallType | null;
}

/**
 * The recent conversation as chat messages (owner = user, bot = assistant),
 * without the message being answered now, which handleChat already recorded.
 */
function conversationHistory(
  username: string,
  userMessage: string
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const turns = [...recentConversation()];
  const last = turns.at(-1);
  if (last?.role === "owner" && last.text === userMessage.trim().slice(0, last.text.length)) turns.pop();
  return turns.map((turn) =>
    turn.role === "owner"
      ? { role: "user" as const, content: `${username}: ${turn.text}` }
      : { role: "assistant" as const, content: turn.text }
  );
}

// Function to send a message to OpenAI and get a response
export async function sendMessageToOpenAI(
  username: string,
  userMessage: string
): Promise<OpenAI.Chat.Completions.ChatCompletion.Choice | null> {
  try {
    const openAiResponse = await openai.chat.completions.create({
      model: "gpt-6-luna",
      reasoning_effort: "none",
      messages: [
        {
          role: "system",
          content: setupMessage,
        },
        ...conversationHistory(username, userMessage),
        { role: "user", content: `${stateLine()}\n${username}: ${userMessage}` },
      ],
      tools: tools,
    });

    console.log("OpenAI Response:", openAiResponse);

    return openAiResponse.choices[0];
  } catch (error) {
    console.error("Error communicating with OpenAI:", error);
    return null;
  }
}

// Function to handle OpenAI responses and tool calls
export async function handleOpenAIResponse(
  username: string,
  message: string
): Promise<HandleResponseType> {
  const openAiChoice = await sendMessageToOpenAI(username, message);

  if (!openAiChoice) {
    return {
      response:
        "I'm having trouble processing that request right now. Please try again later.",
      toolCall: null,
    };
  }

  const response = openAiChoice.message?.content || null;
  const firstToolCall = openAiChoice.message?.tool_calls?.[0];
  const toolCall =
    firstToolCall?.type === "function" ? firstToolCall.function : null;

  console.log("Response:", response);
  console.log("Tool Call:", toolCall);

  if (response || toolCall) {
    return { response, toolCall };
  }

  return {
    response: "Sorry, I couldn't understand that request.",
    toolCall: null,
  };
}

// Function to execute tool calls if needed
export async function executeToolCall(
  toolCall: ToolCallType | null
): Promise<ToolActionType | null> {
  if (toolCall) {
    const { name, arguments: toolArgs } = toolCall;
    try {
      if (toolArgs) {
        const parsedArgs = JSON.parse(toolArgs);
        // console.log(`Executing tool: ${name} with arguments:`, parsedArgs);
        return { action: name, arguments: parsedArgs };
      } else {
        console.error("Tool arguments are missing or undefined.");
      }
    } catch (error) {
      console.error("Failed to parse tool arguments:", error);
    }
  }
  return null;
}

// Function to initiate a conversation with OpenAI and add actions to the queue
export async function initiateActionFromAI(
  username: string,
  message: string
): Promise<void> {
  const { response, toolCall } = await handleOpenAIResponse(username, message);

  if (toolCall) {
    const toolAction = await executeToolCall(toolCall);
    if (toolAction) {
      if (toolAction.action === BotCommands.Stop) {
        // "stop" must interrupt the running command, so it skips the queue
        console.log("Stop requested: cancelling current command and clearing the queue");
        await stopEverything();
        await executeTool(BotCommands.Stop, toolAction.arguments);
      } else if (isBotAction(toolAction.action)) {
        const actionId = crypto.randomUUID();
        // The model sometimes writes "oak planks" instead of the ID "oak_planks"
        for (const [key, value] of Object.entries(toolAction.arguments ?? {})) {
          if (MINECRAFT_ID_ARGS.has(key) && typeof value === "string") {
            toolAction.arguments[key] = normalizeMinecraftName(value);
          }
        }

        if (INSTANT_COMMANDS.has(toolAction.action)) {
          // Answer right away, without interrupting the running task
          if (response) bot.chat(response);
          try {
            await executeTool(toolAction.action, toolAction.arguments);
          } catch (error) {
            console.error(`Instant command ${toolAction.action} failed:`, error);
          }
          return;
        }

        // Movement/unstuck requests from the owner take over right away;
        // anything else waits, and the owner is told so
        const busyWith = getCurrentCommandName();
        const interrupts = INTERRUPTING_COMMANDS.has(toolAction.action);
        if (busyWith && interrupts) {
          await cancelCurrentCommand(`owner asked for ${toolAction.action}`);
        } else if (busyWith && !response) {
          bot.chat(`Okay, I'll do that after I finish ${busyWith}.`);
        }
        // Log for debugging
        console.log(
          `Adding action to queue: ${
            toolAction.action
          }, with args: ${JSON.stringify(toolAction.arguments)}`
        );
        // Add the parsed action to the queue (interrupting requests go first)
        await addCommandToQueue({
          command: toolAction.action,
          id: actionId,
          priority: interrupts ? 1 : 3,
          retryCount: 0, // Adding the missing retryCount property
          args: toolAction.arguments,
        });
      } else {
        console.error(`Invalid action: ${toolAction.action}`);
      }
    } else {
      console.error("Failed to create tool action from tool call.");
    }
  }

  if (response) {
    bot.chat(response); // Send response to the game
  }
}
