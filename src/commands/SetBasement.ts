// Path: src/actions/SetBasement.ts

import { z } from "zod";
import { Vec3 } from "vec3"; // Add this line to import Vec3
import { bot } from "../index";
import { digDiagonalTunnel } from "../actions/digDiagonalTunnel";
import { breakBlockAt, pickupNearbyItems } from "../actions/worldInteraction";
import {
  getBaseLocation,
  saveBasementLocation,
} from "../managers/persistenceManager";
import { ensurePickaxe } from "../actions/ensure";

export const description = `When user asks the bot to set up a basement, the bot will dig a diagonal tunnel down and 
create a room at the end of the tunnel. Example: "Set up a basement with a room size of 3x3x4",
"Please build a basement", "Let's build a basement".
If no parameters are provided, the bot will use default values 3x3x4 for room size.`;

// Define parameters for SetBasement action
export const parameters = z.object({
  // tunnelDepth: z.number().optional().describe("Depth of the diagonal tunnel"),
  roomSize: z
    .object({
      width: z.number(),
      height: z.number(),
      length: z.number(),
    })
    .describe("Dimensions of the basement room"),
});

// Implement the SetBasement action
export async function execute(args: any) {
  console.log(`Executing SetBasement with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for SetBasement:`, parsed.error);
    return;
  }

  let { roomSize } = parsed.data;
  const basementPosition = getBaseLocation();
  const startPosition = basementPosition
    ? new Vec3(
        basementPosition.x,
        basementPosition.y,
        basementPosition.z
      ).offset(6, 0, 0)
    : bot.entity.position.clone();
  let direction = "south";

  const offsetX = direction === "east" ? 1 : direction === "west" ? -1 : 0;
  const offsetZ = direction === "south" ? 1 : direction === "north" ? -1 : 0;

  // Default values for room size
  const tunnelDepth = 6;
  roomSize = roomSize || { width: 3, height: 3, length: 4 };

  await ensurePickaxe();

  await digDiagonalTunnel(
    direction as any,
    tunnelDepth,
    { width: 1, height: 4 },
    startPosition,
    "basementEntrance"
  );

  // Create the room at the end of the tunnel
  const roomStart = startPosition.offset(
    tunnelDepth * offsetX,
    -tunnelDepth,
    tunnelDepth * offsetZ
  );
  for (let x = 0; x < roomSize.width; x++) {
    for (let y = 0; y < roomSize.height; y++) {
      for (let z = 0; z < roomSize.length; z++) {
        const roomBlock = roomStart.offset(x, y, z);
        await breakBlockAt(roomBlock.x, roomBlock.y, roomBlock.z);
      }
    }
  }
  saveBasementLocation(roomStart);

  await pickupNearbyItems(bot);
  bot.chat("Room is dug out for the basement.");
  bot.chat("Basement setup complete.");
}
