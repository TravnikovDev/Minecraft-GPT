import { z } from "zod";
import { goToPosition, LONG_TRIP_BLOCKS, travelTo } from "../actions/movement";
import { bot } from "../index";
import { isCommandCancelled } from "../managers/actionManager";
import { tellOwner } from "../managers/ownerDialog";

export const description = `When user asks the bot to go to specific coordinates, the bot will navigate to the specified position.
Expected usage: "Go to coordinates x=100, y=64, z=-200" or "Navigate to position 100, 64, -200".`;

// Define parameters for the GoToCoordinates action
export const parameters = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
});

// Implement the GoToCoordinates action
export async function execute(args: any) {
  console.log(`Executing GoToCoordinates with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(
      `Missing or invalid parameters for GoToCoordinates: x, y, or z are undefined or incorrect.`
    );
    return;
  }

  const { x, y, z } = parsed.data;
  const distance = Math.hypot(bot.entity.position.x - x, bot.entity.position.z - z);

  // Short trips: one path search. Long trips: legs with progress updates.
  if (distance <= LONG_TRIP_BLOCKS) {
    const ok = await goToPosition(x, y, z);
    if (!ok && !isCommandCancelled()) tellOwner(`I couldn't find a way to ${x}, ${y}, ${z}.`);
    return;
  }

  tellOwner(`Heading to ${x}, ${y}, ${z}, about ${Math.round(distance)} blocks away.`);
  const arrived = await travelTo(() => ({ x, y, z }), {
    onProgress: (percent) => tellOwner(`On my way: ${percent}% there.`),
  });
  if (isCommandCancelled()) return;
  tellOwner(arrived ? `I'm at ${x}, ${y}, ${z}!` : `I got stuck on the way to ${x}, ${y}, ${z}.`);
}
