// Path: src/commands/CraftItem.ts

import { z } from "zod";
import { craftRecipe } from "../actions/crafting";
import { planCraft, readyVariants, resolveCraftable, type CraftStep } from "../actions/craftPlanner";
import { bot } from "../core/body";
import { BotCommands } from "./types";
import { isCommandCancelled } from "../core/commandContext";
import { queueCommand } from "../managers/actionManager";
import { askOwner, tellOwner } from "../managers/ownerDialog";
import { inventoryFull } from "../actions/storage";
import { makeRoom } from "../actions/overflow";
import { isArmorPiece, wearBestArmor } from "../actions/armor";

export const description = `When player is asking the bot to craft an item, the bot works out the recipe, makes the
parts it can (planks from logs, sticks from planks), uses or places a crafting table, and crafts the item. If raw
materials are missing it says what is missing and offers to go and get them.
Generic names are fine ("bed", "planks", "helmet"); with one possible variant the bot makes it, with several it
asks the owner which one (then call again with the exact ID the owner picked, e.g. iron_helmet). Sets are fine too: "armor" / "iron armor" means helmet, chestplate, leggings and boots,
"tools" / "stone tools" means pickaxe, axe, shovel and sword. Pass the owner's words for these as they are.
Example: "Craft a diamond sword", "Craft 5 planks", "Craft 10 torches", "Make me a bed", "Craft iron armor",
"Make stone tools".`;

// Define parameters for CraftItem action
export const parameters = z.object({
  itemName: z.string().describe("Minecraft ID of the item to craft, or a generic name like bed or planks."),
  itemCount: z.number().nullable().describe("The number of items to craft."),
});

const pretty = (name: string): string => name.replace(/_/g, " ");

// Sets: "armor", "iron armor", "full diamond armor", "stone tools", "set of iron tools"...
const SET_REQUEST = /^(?:full[ _])?(?:set[ _]of[ _])?(?:([a-z]+)[ _])?(armou?rs?|tools)(?:[ _]set)?$/i;
const SET_PIECES: Record<string, string[]> = {
  armor: ["helmet", "chestplate", "leggings", "boots"],
  tools: ["pickaxe", "axe", "shovel", "sword"],
};
const MATERIALS: Record<string, string> = {
  wood: "wooden", wooden: "wooden", stone: "stone", iron: "iron", gold: "golden", golden: "golden",
  diamond: "diamond", netherite: "netherite", leather: "leather", chain: "chainmail", chainmail: "chainmail",
};

/** The pieces of a set request ("iron tools" -> iron_pickaxe...), or null if it isn't one. */
function setPieces(requested: string): string[] | null {
  const match = SET_REQUEST.exec(requested.trim());
  if (!match) return null;
  const kind = match[2]!.toLowerCase().startsWith("tool") ? "tools" : "armor";
  const word = match[1]?.toLowerCase();
  if (word && !MATERIALS[word]) return null;
  const material = word ? MATERIALS[word] : null;
  return SET_PIECES[kind]!.map((piece) => (material ? `${material}_${piece}` : piece));
}

/** "a, b or c" */
const orList = (names: string[]): string =>
  names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;

/** The material of a tool or armor piece: iron_helmet -> iron. */
const materialOf = (name: string): string => pretty(name.slice(0, name.lastIndexOf("_")));

// Multi-word variant prefixes that are still just a color or wood type
const PLAIN_PREFIXES = new Set(["dark_oak", "light_blue", "light_gray"]);

/**
 * True when a loose name turned into something the owner may not mean:
 * "armor" -> leather_horse_armor is unusual, "bed" -> white_bed is not.
 */
function isUnusualMatch(requested: string, item: string): boolean {
  const asked = requested.trim().toLowerCase().replace(/\s+/g, "_");
  const singular = asked.replace(/s$/, "");
  if (item === asked || item === singular) return false;
  const kind = item.endsWith(`_${singular}`) ? singular : item.endsWith(`_${asked}`) ? asked : null;
  if (!kind) return true;
  const prefix = item.slice(0, -kind.length - 1);
  return prefix.includes("_") && !PLAIN_PREFIXES.has(prefix);
}

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

  // With no free slot a crafted item has nowhere to go and is lost (the
  // planks for a chest vanished this way): make room first (a chest)
  if (inventoryFull() && !(await makeRoom(`craft ${pretty(parsed.data.itemName)}`))) return;

  // A set ("armor", "iron tools"): one craft per piece, each picking the best material it can make
  const pieces = setPieces(parsed.data.itemName);
  if (pieces) {
    // No material said and more than one possible: the owner picks
    if (!pieces[0]!.includes("_")) {
      const materials = [...new Set(pieces.flatMap((p) => readyVariants(p, count).map(materialOf)))];
      if (materials.length > 1) {
        bot.chat(`I can make that from ${orList(materials)}. Which one?`);
        return;
      }
    }
    tellOwner(`Making ${pieces.map(pretty).join(", ")}.`);
    for (const piece of pieces) {
      queueCommand({
        id: crypto.randomUUID(),
        command: BotCommands.CraftItem,
        priority: 3,
        retryCount: 0,
        args: { itemName: piece, itemCount: count },
      });
    }
    return;
  }

  // A generic name with several variants the bot could make now: the owner picks
  const ready = readyVariants(parsed.data.itemName.trim().toLowerCase().replace(/\s+/g, "_"), count);
  if (ready.length > 1) {
    bot.chat(`I can make ${orList(ready.map(pretty))}. Which one?`);
    return;
  }

  const item = resolveCraftable(parsed.data.itemName, count);
  if (!item) {
    bot.chat(`I don't know how to craft "${pretty(parsed.data.itemName)}".`);
    return;
  }

  // A loose name that matched something odd: check with the owner first
  if (isUnusualMatch(parsed.data.itemName, item)) {
    askOwner(`Did you mean ${count} ${pretty(item)}?`, async () => {
      queueCommand({
        id: crypto.randomUUID(),
        command: BotCommands.CraftItem,
        priority: 3,
        retryCount: 0,
        args: { itemName: item, itemCount: count },
      });
    });
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
        queueCommand({
          id: crypto.randomUUID(),
          command: gather!.command,
          priority: 3,
          retryCount: 0,
          args: gather!.args,
        });
      }
      // Then try the craft again (it re-plans with the new inventory)
      queueCommand({
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
  // Crafted armor goes on right away (the armor plugin only handles picked-up armor)
  if (isArmorPiece(item)) await wearBestArmor();
}
