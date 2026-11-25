// Path: src/commands/StoreItems.ts
// Puts items away in a chest: the ones the owner names, spare resources,
// duplicate gear, or everything. See actions/storage.ts for what it keeps.

import { z } from "zod";
import { reply } from "../core/narrator";
import { storeItems, describeContents } from "../actions/storage";

export const description = `Puts items from the bot's inventory into a chest (the nearest chest it remembers, or one nearby).
what: "items" for the items the owner names (fill items), "resources" for spare materials (everything except its tools,
weapons, armor, food, torches, arrows, bed and crafting table), "duplicates" for extra copies (keeps the best tool, weapon
and armor piece of each kind and the biggest stack of each item), "all" for everything it carries.
Examples: "Put the cobblestone in the chest" (items), "Store 32 dirt" (items, count 32), "Put your resources in the chest"
(resources), "Put all duplicates in the chest" (duplicates), "Empty your inventory into the chest" (all),
"Your inventory is full, store something" (resources).`;

export const parameters = z.object({
  what: z.enum(["items", "resources", "duplicates", "all"]).describe("What to put away."),
  items: z
    .array(
      z.object({
        name: z.string().describe("Minecraft ID or a category like planks, logs, food."),
        count: z.number().nullable().describe("How many; null for all of them."),
      })
    )
    .nullable()
    .describe('The items to store when what is "items"; null otherwise.'),
});

export async function execute(args: any): Promise<void> {
  console.log(`Executing StoreItems with args:`, args);
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for StoreItems.`, parsed.error);
    return;
  }
  const { what } = parsed.data;
  const wanted = parsed.data.items ?? [];
  if (what === "items" && wanted.length === 0) {
    reply("What should I put in the chest?");
    return;
  }

  const result = await storeItems(what, wanted);
  if (!result) {
    reply("I don't know any chest around here. Place one, or show me one and say 'remember this chest'.");
    return;
  }
  const { stored, leftOver, chestAt, problem } = result;
  if (problem && stored.size === 0) {
    reply(`I couldn't use the chest at ${chestAt}: ${problem}.`);
    return;
  }
  if (stored.size === 0 && leftOver.size === 0) {
    const none =
      what === "items"
        ? `I don't have any ${wanted.map((w) => w.name.replace(/_/g, " ")).join(" or ")}.`
        : what === "duplicates"
          ? "I don't carry any duplicates."
          : "I have nothing to put away.";
    reply(none);
    return;
  }
  const put = stored.size > 0 ? `Put ${describeContents(stored)} in the chest at ${chestAt}.` : "";
  const full = leftOver.size > 0 ? ` The chest is full; I still have ${describeContents(leftOver)}.` : "";
  reply(`${put}${full}`.trim());
}
