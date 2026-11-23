// Path: src/managers/aiManager.ts

import OpenAI from "openai";
import { OPENAI_API_KEY } from "../config/env";
import { bot } from "..";
import { BotCommands, isBotAction } from "../commands/types";
import { executeTool, tools } from "./toolManager";
import { addCommandToQueue } from "./persistenceManager";
import { stopEverything } from "./actionManager";
import { normalizeMinecraftName } from "../utils/utility";

// Initialize OpenAI Client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const setupMessage = `You are MinecraftGPT, a bot playing Minecraft together with the players who chat with you.
Talk like a friendly, enthusiastic 12-year-old who loves Minecraft and wants to play along.

How to respond:
- When a player asks you to do something in the game, call the one tool that best matches the request.
- Use exact Minecraft IDs for items, blocks and mobs, e.g. oak_log, oak_planks, cobblestone, zombie.
- When you just talk, reply in plain text: one or two short sentences.
- Never put JSON, code or markdown in your reply; it is shown as-is in Minecraft chat.
- If a request is unclear or no tool fits, ask a short clarifying question.`;

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
        { role: "user", content: `${username}: ${userMessage}` },
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
        // Log for debugging
        console.log(
          `Adding action to queue: ${
            toolAction.action
          }, with args: ${JSON.stringify(toolAction.arguments)}`
        );
        // Add the parsed action to the queue with priority 3
        await addCommandToQueue({
          command: toolAction.action,
          id: actionId,
          priority: 3,
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
