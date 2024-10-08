// Path: src/managers/aiManager.ts

import OpenAI from "openai";
import { tools } from "./toolManager";
import { OPENAI_API_KEY } from "../config/env";
import { v4 as uuidv4 } from "uuid";

// Initialize OpenAI Client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Function to send a message to OpenAI and get a response
export async function sendMessageToOpenAI(userMessage: string) {
  try {
    const openAiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful Minecraft assistant. Use the supplied tools to assist the user.",
        },
        { role: "user", content: userMessage },
      ],
      tools: tools,
    });

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

  if (response) {
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
    console.log(`AI Response to ${username}:`, response);
  }

  if (toolCall) {
    const toolAction = await executeToolCall(toolCall);
    if (toolAction) {
      const actionId = uuidv4();
      // Add the parsed action to the queue with priority 3
      return { id: actionId, ...toolAction, priority: 3 };
    }
  }

  return null;
}
