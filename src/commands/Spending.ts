// Path: src/commands/Spending.ts
// "How much have you spent?": this month's model spending, answered by code.

import { z } from "zod";
import { reply } from "../core/narrator";
import { monthlyCap, thisMonth } from "../planner/cost";

export const description = `Says how much the bot's thinking (model calls for chat and day plans) has cost this month, against the monthly cap.
Example: "How much have you spent?", "What's your budget?", "How much did the AI cost this month?".`;

export const parameters = z.object({});

export async function execute(): Promise<void> {
  const m = thisMonth();
  const parts = Object.entries(m.byPurpose).map(([purpose, usd]) => `${purpose === "plan" ? "day plans" : "chat"} $${usd.toFixed(3)}`);
  reply(`This month (${m.month}): $${m.usd.toFixed(3)} of $${monthlyCap()} in ${m.calls} calls${parts.length ? ` (${parts.join(", ")})` : ""}.`);
}
