// Path: src/managers/aiManager.ts

import OpenAI from "openai";
import { OPENAI_API_KEY } from "../config/env";
import { v4 as uuidv4 } from "uuid";
import { addActionToQueue } from "./actionManager";
import { bot } from "..";
import { isBotAction } from "./actionTypes";
import { tools } from "./toolSchemas";

// Initialize OpenAI Client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const setupMessage = `You are a helpful Minecraft assistant. Use the supplied tools to assist the user.
Here are some example commands you can understand and how to respond:
- 'Follow me': Use the FollowPlayer tool with 'player_name' as the user who gave the command and 'follow_dist' as 2.
- 'Gather oak wood': Use the CollectBlocks tool with 'oak_log' as the type.
- 'Go to player John': Use the GoToPlayer tool with player_name as John.
- 'Defend yourself': Use the DefendSelf tool.
- 'Stop': Use the StopMovement or StopCombat tool.
If the user's request doesn't match one of these actions, politely ask them to clarify.`;

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
      model: "gpt-4o-mini",
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
  const toolCall = openAiChoice.message?.tool_calls?.[0].function || null;

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
        console.log(`Executing tool: ${name} with arguments:`, parsedArgs);
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
): Promise<boolean> {
  const { response, toolCall } = await handleOpenAIResponse(username, message);

  if (response) {
    bot.chat(response); // Send response to the game
    return true;
  }

  if (toolCall) {
    const toolAction = await executeToolCall(toolCall);
    if (toolAction) {
      if (isBotAction(toolAction.action)) {
        const actionId = uuidv4();
        // Log for debugging
        console.log(
          `Adding action to queue: ${
            toolAction.action
          }, with args: ${JSON.stringify(toolAction.arguments)}`
        );
        // Add the parsed action to the queue with priority 3
        await addActionToQueue(toolAction.action, 3, toolAction.arguments);

        return true;
      } else {
        console.error(`Invalid action: ${toolAction.action}`);
      }
    } else {
      console.error("Failed to create tool action from tool call.");
    }
  }

  return false;
}