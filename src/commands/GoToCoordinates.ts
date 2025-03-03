import { z } from "zod";
import { goToPosition } from "../actions/movement";

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
  await goToPosition(x, y, z);
}
