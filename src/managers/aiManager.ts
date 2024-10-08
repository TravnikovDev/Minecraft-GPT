// Path: src/managers/aiManager.ts

import OpenAI from "openai";
import { tools } from "./toolManager";
import { OPENAI_API_KEY } from "../config/env";
import { v4 as uuidv4 } from "uuid";
import { addActionToQueue } from "./actionManager";
import { bot } from "..";

// Initialize OpenAI Client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const setupMessage = `You are a helpful Minecraft assistant. Use the supplied tools to assist the user.
Here are some example commands you can understand and how to respond:
- 'Follow me': Use the FollowPlayer tool.
- 'Gather oak wood': Use the CollectBlocks tool with 'oak_log' as the type.
- 'Go to player John': Use the GoToPlayer tool with player_name as John.
- 'Defend yourself': Use the DefendSelf tool.
- 'Stop': Use the StopMovement or StopCombat tool.
If the user's request doesn't match one of these actions, politely ask them to clarify.`;

// Function to send a message to OpenAI and get a response
export async function sendMessageToOpenAI(userMessage: string) {
  try {
    const openAiResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: setupMessage,
        },
        { role: "user", content: userMessage },
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
export async function handleOpenAIResponse(username: string, message: string) {
  const openAiChoice = await sendMessageToOpenAI(message);

  if (!openAiChoice) {
    return {
      response:
        "I'm having trouble processing that request right now. Please try again later.",
      toolCall: null,
    };
  }

  const response = openAiChoice.message?.content;
  const toolCall = openAiChoice.message?.tool_calls?.[0].function;

  if (response || toolCall) {
    return { response, toolCall };
  }

  return {
    response: "Sorry, I couldn't understand that request.",
    toolCall: null,
  };
}

// Function to execute tool calls if needed
export async function executeToolCall(toolCall: any) {
  if (toolCall) {
    const { name, arguments: toolArgs } = toolCall;
    try {
      const parsedArgs = JSON.parse(toolArgs);
      console.log(`Executing tool: ${name} with arguments:`, parsedArgs);
      return { action: name, arguments: parsedArgs };
    } catch (error) {
      console.error("Failed to parse tool arguments:", error);
    }
  }
  return null;
}

// Function to initiate a conversation with OpenAI and add actions to the queue
export async function initiateActionFromAI(username: string, message: string) {
  const { response, toolCall } = await handleOpenAIResponse(username, message);

  if (response) {
    bot.chat(response); // Send response to the game
  }

  if (toolCall) {
    const toolAction = await executeToolCall(toolCall);
    if (toolAction) {
      const actionId = uuidv4();
      // Add the parsed action to the queue with priority 3
      await addActionToQueue(toolAction.action, 3, toolAction.arguments);
    }
  }
}
