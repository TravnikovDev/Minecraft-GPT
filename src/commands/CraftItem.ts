// Path: src/commands/CraftItem.ts

import { z } from "zod";
import { craftRecipe } from "../actions/crafting";
import { planCraft, resolveCraftable, type CraftStep } from "../actions/craftPlanner";
import { bot } from "..";
import { BotCommands } from "./types";
import { isCommandCancelled } from "../managers/actionManager";
import { addCommandToQueue } from "../managers/persistenceManager";
import { askOwner, tellOwner } from "../managers/ownerDialog";

export const description = `When player is asking the bot to craft an item, the bot works out the recipe, makes the
parts it can (planks from logs, sticks from planks), uses or places a crafting table, and crafts the item. If raw
materials are missing it says what is missing and offers to go and get them.
Generic names are fine ("bed", "planks"); the bot picks the variant it can make.
Example: "Craft a diamond sword", "Craft 5 planks", "Craft 10 torches", "Make me a bed".`;

// Define parameters for CraftItem action
export const parameters = z.object({
  itemName: z.string().describe("Minecraft ID of the item to craft, or a generic name like bed or planks."),
  itemCount: z.number().nullable().describe("The number of items to craft."),
});

const pretty = (name: string): string => name.replace(/_/g, " ");

// When the bot last went to gather materials for an item; if the retry still
// lacks them, it explains instead of asking the same question again
const GATHER_MEMORY_MS = 5 * 60 * 1000;
const lastGatherFor = new Map<string, number>();
const listOf = (items: CraftStep[]): string => items.map((m) => `${m.count} ${pretty(m.name)}`).join(", ");

/** The command that gathers a missing raw material, or null if the bot can't yet. */
function gatherCommandFor(material: CraftStep): { command: BotCommands; args: object } | null {
  if (material.name === "logs") {
    return { command: BotCommands.GatherWood, args: { num: material.count } };
  }
  if (material.name === "cobblestone") {
    return { command: BotCommands.CollectBlocks, args: { blockType: "stone", num: material.count, range: null } };
  }
  if (material.name.endsWith("_wool")) {
    // Each sheep drops one wool of its color; white sheep are by far the most common
    return { command: BotCommands.Hunting, args: { mobType: "sheep", count: material.count, maxDistance: null } };
  }
  return null;
}

// Implement the CraftItem action
export async function execute(args: any): Promise<void> {
  console.log(`Executing CraftItem with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for CraftItem:`, parsed.error);
    return;
  }

  const count = Math.max(1, parsed.data.itemCount ?? 1);
  const item = resolveCraftable(parsed.data.itemName, count);
  if (!item) {
    bot.chat(`I don't know how to craft "${pretty(parsed.data.itemName)}".`);
    return;
  }

  const plan = planCraft(item, count);
  console.log(`Craft plan for ${count} ${item}:`, JSON.stringify(plan));

  if (plan.missing.length > 0) {
    const gathers = plan.missing.map((m) => ({ material: m, gather: gatherCommandFor(m) }));
    const unknown = gathers.filter((g) => !g.gather).map((g) => g.material);
    const need = `To craft ${count} ${pretty(item)} I'm missing ${listOf(plan.missing)}.`;

    if (unknown.length > 0) {
      bot.chat(`${need} I don't know how to get ${listOf(unknown)} yet.`);
      return;
    }

    const triedAt = lastGatherFor.get(item);
    if (triedAt && Date.now() - triedAt < GATHER_MEMORY_MS) {
      lastGatherFor.delete(item);
      const hint = plan.missing.some((m) => m.name.endsWith("_wool"))
        ? " I couldn't find enough sheep nearby; you could give me the wool."
        : " I couldn't find enough nearby; you could give them to me.";
      bot.chat(`${need}${hint}`);
      return;
    }

    askOwner(`${need} Should I go get them?`, async () => {
      tellOwner("Okay, going to get them!");
      lastGatherFor.set(item, Date.now());
      for (const { gather } of gathers) {
        await addCommandToQueue({
          id: crypto.randomUUID(),
          command: gather!.command,
          priority: 3,
          retryCount: 0,
          args: gather!.args,
        });
      }
      // Then try the craft again (it re-plans with the new inventory)
      await addCommandToQueue({
        id: crypto.randomUUID(),
        command: BotCommands.CraftItem,
        priority: 3,
        retryCount: 0,
        // the owner's original wording, so e.g. "bed" picks the color of the wool we got
        args: { itemName: parsed.data.itemName, itemCount: count },
      });
    });
    return;
  }

  // Everything is available: craft the parts first, then the item
  const parts = plan.steps.slice(0, -1);
  if (parts.length > 0) console.log(`Crafting parts first: ${listOf(parts)}`);
  for (const step of plan.steps) {
    if (isCommandCancelled()) return;
    const ok = await craftRecipe(step.name, step.count);
    if (!ok) {
      bot.chat(
        step.name === item
          ? `I couldn't craft ${pretty(item)}, even though I have the materials.`
          : `I couldn't make the ${pretty(step.name)} I need for ${pretty(item)}.`
      );
      return;
    }
  }
  bot.chat(`Crafted ${count} ${pretty(item)}${parts.length ? ` (made ${listOf(parts)} first)` : ""}.`);
}
