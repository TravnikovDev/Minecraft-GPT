// Path: src/commands/Progress.ts
// "What's your progress?": the first-day milestones done and still to do.

import { z } from "zod";
import { reply } from "../core/narrator";
// The curriculum is loaded when used: it reaches back to the command registry

export const description = `Says how far the bot is with its milestones (first day: tools, a shelter, food, a bed,
chests). Answers immediately. Examples: "What's your progress?", "How far are you?", "What are your goals?"`;

export const parameters = z.object({});

export async function execute(): Promise<void> {
  const { progressReport } = await import("../skills/curriculum");
  reply(progressReport());
}
