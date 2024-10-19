// Path: src/actions/DigDirectionalTunnel.ts

import { z } from "zod";
import { bot } from "../index";
import { digDiagonalTunnel } from "../actions/digging";
import { ensurePickaxe } from "../actions/ensureTools";

export const description = `Dig a tunnel in the specified direction. The bot will dig a tunnel of the specified depth 
and dimensions, placing torches at the specified interval. If no parameters are provided, the bot will dig a tunnel
10 blocks deep, 3 blocks wide, and 4 blocks high, placing a torch every 12 blocks towards north. Example usage:
'Please build a tunnel', 'Let's mine', 'Build a mine', "Dig a tunnel 20 blocks deep",
"Dig a 3x3 tunnel towards east", "Please dig a tunnel 10 blocks deep towards south."`;

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
  tunnelName: z.string().optional().describe("Name of the tunnel"),
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

  let { depth, torchInterval, tunnelSize, direction, tunnelName } = parsed.data;
  const startPosition = bot.entity.position;

  // Default values for tunnel size
  depth = depth || 10;
  torchInterval = torchInterval || 10;
  tunnelSize = tunnelSize || { width: 3, height: 4 };
  direction = direction || "north";

  await ensurePickaxe();

  const result = await digDiagonalTunnel(
    direction,
    depth,
    tunnelSize,
    startPosition,
    tunnelName,
    torchInterval
  );

  if (result) {
    bot.chat(`Tunnel ${tunnelName} setup complete.`);
  } else {
    bot.chat(`Failed to dig ${tunnelName} tunnel`);
  }
}
