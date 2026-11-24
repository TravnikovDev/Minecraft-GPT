// Path: src/commands/GoByBoat.ts

import { z } from "zod";
import { bot } from "../core/body";
import { goByBoat } from "../actions/boat";

export const description = `Travels to coordinates by boat across water: crafts a boat if it has none, puts it on
the nearest water, rows toward the spot and lands on the shore closest to it, taking the boat back.
Long trips with water on the way already use a boat on their own; use this when the owner asks for the boat.
Example: "Take the boat to 300 -150", "Row to 120 400", "Go by boat to 50 60".`;

export const parameters = z.object({
  x: z.number().describe("Target x coordinate."),
  z: z.number().describe("Target z coordinate."),
});

export async function execute(args: any): Promise<void> {
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for GoByBoat.`);
    return;
  }
  const target = { x: parsed.data.x, z: parsed.data.z };
  const ok = await goByBoat(target);
  const p = bot.entity.position.floored();
  bot.chat(
    ok
      ? `Landed at ${p.x}, ${p.y}, ${p.z}.`
      : "I couldn't go by boat: I need a boat (or wood for one) and open water nearby that leads that way."
  );
}
