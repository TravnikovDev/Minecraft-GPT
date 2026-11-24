// Path: src/commands/PlantSaplings.ts
// Plants saplings it carries: on the stumps of trees it cut first (each with
// its own kind when it has it), or on free ground next to the owner.

import { z } from "zod";
import { bot } from "../core/body";
import { plantSaplings } from "../actions/forestry";
import { ownerEntity } from "../managers/ownerDialog";

export const description = `Plants saplings the bot carries: on the stumps of trees it cut (replanting them), or with
near "owner" on free ground next to the owner ("plant it here"). Not for picking saplings up (that's pickupNearbyItems).
Examples: "Replant the trees", "Plant the saplings", "Plant an oak sapling here" (near owner, sapling oak_sapling, count 1),
"Plant your saplings around me" (near owner).`;

export const parameters = z.object({
  near: z.string().nullable().describe('"owner" to plant next to the owner; null for the stumps of trees it cut.'),
  sapling: z.string().nullable().describe("Which sapling, e.g. oak_sapling; null for any it carries."),
  count: z.number().nullable().describe("How many to plant; null for all it can."),
});

export async function execute(args: any): Promise<void> {
  console.log(`Executing PlantSaplings with args:`, args);
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for PlantSaplings.`, parsed.error);
    return;
  }
  const carried = bot.inventory.items().filter((i) => i.name.endsWith("_sapling") || i.name === "mangrove_propagule");
  if (carried.length === 0) {
    bot.chat("I don't have any saplings.");
    return;
  }
  let center = null;
  if (parsed.data.near) {
    const owner = ownerEntity();
    if (!owner) {
      bot.chat("I can't see you, so I don't know where to plant.");
      return;
    }
    center = owner.position.floored();
  }
  const planted = await plantSaplings(center, parsed.data.sapling, parsed.data.count ?? 64);
  const total = [...planted.values()].reduce((a, b) => a + b, 0);
  if (total === 0) {
    bot.chat("I couldn't find free soil to plant on.");
    return;
  }
  const kinds = [...planted.entries()].map(([name, n]) => `${n} ${name.replace(/_/g, " ")}${n === 1 ? "" : "s"}`).join(", ");
  bot.chat(`Planted ${kinds}.`);
}
