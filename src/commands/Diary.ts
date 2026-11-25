// Path: src/commands/Diary.ts
// "What did you do today?": today's diary, read out by code (no model call).

import { z } from "zod";
import { reply } from "../core/narrator";
import { summaries, today } from "../planner/diary";

export const description = `Tells the owner what the bot did today (or yesterday), from its diary.
Example: "What did you do today?", "How was your day?", "What happened yesterday?", "Read me your diary".`;

export const parameters = z.object({
  yesterday: z.boolean().nullable().describe("True for yesterday (its summary of that day), null or false for today."),
});

export async function execute(args: { yesterday?: boolean | null } = {}): Promise<void> {
  if (args.yesterday) {
    const last = summaries().at(-1);
    reply(last ? `Day ${last.day}: ${last.text}` : "I don't have a summary of yesterday yet.");
    return;
  }
  const text = today();
  if (!text) {
    reply("Nothing much yet today.");
    return;
  }
  // The last few lines: chat lines are short
  const lines = text.split("\n");
  reply(lines.slice(-8).join(" | "));
}
