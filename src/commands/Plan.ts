// Path: src/commands/Plan.ts
// The owner and the day plan (Phase 7): "what's your plan?" shares it (and
// makes one when there's none); "skip mining today, build a fence" plans the
// day again around what the owner asked. The owner always outranks the plan.

import { z } from "zod";
import { reply } from "../core/narrator";

export const description = `The bot's plan for its day. With no request, it tells its plan (making one if it has none). With a request, it plans its day again around it.
Example: "What's your plan?", "What are you doing today?" (request null); "Skip mining today, get food instead", "Let's build up iron today", "Make a new plan" (request: the owner's words, or "make a new plan").`;

export const parameters = z.object({
  request: z.string().nullable().describe("The owner's change to the plan in their words, or null to just hear the plan."),
});

export async function execute(args: { request?: string | null } = {}): Promise<void> {
  const { autonomyOn } = await import("../skills/curriculum");
  const { planningOn, planDay } = await import("../planner/planner");
  const { currentPlan, describePlan } = await import("../planner/plan");
  const { overBudget } = await import("../planner/cost");
  const request = args.request?.trim() || null;

  if (!request && currentPlan()) {
    reply(describePlan());
    return;
  }
  if (!planningOn(autonomyOn())) {
    const why = !autonomyOn()
      ? "I only plan my days when I live my own life (say \"go live your life\")"
      : overBudget()
        ? "I've used up this month's thinking budget, so I follow my milestones for now"
        : "I plan my days once my first day is done; I'm still working on it";
    reply(`${why}.`);
    return;
  }
  reply(request ? "Okay, let me plan my day around that." : "Let me think about my day.");
  // planDay reports the new plan itself
  if (!(await planDay("owner asked", request))) reply("I couldn't make a plan just now; I'll follow my milestones.");
}
