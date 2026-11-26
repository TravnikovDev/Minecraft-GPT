// Path: src/commands/Autonomy.ts
// The owner lets the bot live its own life (go for its milestones, sleep in
// its shelter at night) or asks it to stay and wait for orders.

import { z } from "zod";
import { reply } from "../core/narrator";
// The curriculum is loaded when used: it reaches back to the command registry

export const description = `Turns the bot's own life on or off. On: when the owner gives no orders, it works toward its
milestones by itself (tools, a shelter, food, a bed, chests) and sleeps in its shelter at night. Off: it only does what
the owner asks. Examples (on): "Go live your life", "You're free", "Do your own thing", "Play on your own".
Examples (off): "Stay with me", "Take a break", "Wait for my orders", "Stop doing your own thing".`;

export const parameters = z.object({
  on: z.boolean().describe("true to let it live its own life, false to wait for orders."),
});

export async function execute(args: unknown): Promise<void> {
  const parsed = parameters.safeParse(args);
  if (!parsed.success) return;
  const { automationAllowed } = await import("../config/serverProfile");
  if (parsed.data.on && !automationAllowed()) {
    reply("This server doesn't allow bots to act on their own, so I'll wait for your orders.");
    return;
  }
  const { progressReport, setAutonomy } = await import("../skills/curriculum");
  await setAutonomy(parsed.data.on);
  reply(parsed.data.on ? `Okay, I'll look after myself! ${progressReport()}` : "Okay, I'll wait for your orders.");
}
