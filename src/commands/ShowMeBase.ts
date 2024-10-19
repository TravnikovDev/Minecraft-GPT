// Path: src/actions/ShowMeBase.ts

import { z } from "zod";
import { Entity } from "prismarine-entity";
import { bot } from "../index";
import { goToPosition } from "../actions/movement";
import { getNearbyPlayerNames } from "../actions/world";
import { __actionsDelay } from "../utils/utility";
import { getBaseLocation } from "../managers/persistenceManager";

export const description = `When user asks the bot to show the base, the bot will navigate to the base location.
Expected usage: "Show me the base" or "Show the base to the player name" or "Show the base to the player_name".`;

// Define parameters for the ShowMeBase action
export const parameters = z.object({
  player_name: z
    .string()
    .optional()
    .describe("The name of the player to go to."),
  //   base_name: z.string().optional().describe("The name of the base to go to."),
});

// Implement the ShowMeBase action
export async function execute(args: any = {}) {
  // Validate arguments
  const parsed = parameters.parse(args);

  let { player_name } = parsed || {};

  let baseLocation = getBaseLocation();

  if (!baseLocation) {
    bot.chat(`I don't know where the base is.`);
    return;
  }

  let targetPlayer: Entity;
  if (player_name) {
    targetPlayer = bot.players[player_name]?.entity;
  } else {
    const players = getNearbyPlayerNames(1000);
    targetPlayer = bot.players[players[0]].entity;
  }

  if (targetPlayer) {
    bot.chat(`Heading towards ${targetPlayer.name}.`);
    await goToPosition(
      targetPlayer.position.x,
      targetPlayer.position.y,
      targetPlayer.position.z
    );
    await bot.lookAt(targetPlayer.position.offset(0, 1.6, 0));
    bot.chat(
      `I'm here! ${player_name} I'm waiting for you 10 seconds and will go back to base`
    );
    await __actionsDelay(10000);
    await goToPosition(baseLocation.x, baseLocation.y, baseLocation.z);
  } else {
    bot.chat(`I can't find ${player_name}.`);
  }
}
