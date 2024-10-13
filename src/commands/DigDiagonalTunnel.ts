// Path: src/actions/DigDirectionalTunnel.ts

import { z } from "zod";
import { bot } from "../index";
import { digDiagonalTunnel } from "../actions/digDiagonalTunnel";

export const description = `Dig a tunnel in the specified direction. The bot will dig a tunnel of the specified depth 
and dimensions, placing torches at the specified interval. If no parameters are provided, the bot will dig a tunnel
10 blocks deep, 3 blocks wide, and 4 blocks high, placing a torch every 12 blocks towards north. Example usage:
'Please build a tunnel', 'Let's mine', 'Build a mine', "Dig a tunnel 20 blocks deep",
"Dig a 3x3 tunnel towards east", "Please dig a tunnel 10 blocks deep towards south."`;

// TODO: Move it as separate function in utility

// Define parameters for DigDirectionalTunnel action
export const parameters = z.object({
  depth: z.number().optional().describe("Depth of the tunnel"),
  torchInterval: z.number().optional().describe("Interval for torch placement"),
  tunnelSize: z
    .object({
      width: z.number(),
      height: z.number(),
    })
    .optional()
    .describe("Dimensions of the tunnel"),
  direction: z
    .enum(["north", "south", "west", "east"])
    .optional()
    .describe("Tunnel direction"),
});

// Implement the DigDirectionalTunnel action
export async function execute(args: any) {
  console.log(`Executing DigDirectionalTunnel with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for DigDirectionalTunnel:`, parsed.error);
    return;
  }

  let { depth, torchInterval, tunnelSize, direction } = parsed.data;

  // Default values for tunnel size
  depth = depth || 10;
  torchInterval = torchInterval || 12;
  tunnelSize = tunnelSize || { width: 3, height: 4 };
  direction = direction || "north";

  digDiagonalTunnel(direction, depth, tunnelSize, torchInterval);

  bot.chat("Tunnel setup complete.");
}
