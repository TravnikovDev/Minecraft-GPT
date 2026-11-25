// Path: src/actions/crafting.ts
// Crafting (at the bot's own or a nearby table) and smelting, through the
// checked craft and window primitives in core/.

import * as gameData from "../utils/minecraftData";
import { Vec3 } from "vec3";
import { Item } from "prismarine-item";
import { Block } from "prismarine-block";
import { Recipe } from "prismarine-recipe";
import { craftWith, goTo, withinReach } from "../core/primitives";
import { closeWindow, openFurnaceAt, windowStep } from "../core/containers";
import { describeFailure } from "../core/result";
import { placeBlock } from "./worldInteraction";
import pf from "mineflayer-pathfinder";
import { goToPosition, travelToResult } from "./movement";
import { bot } from "../core/body";
import { isCommandCancelled } from "../core/commandContext";
import { collectBlock } from "./collectBlock";
import { craftNow } from "./craftPlanner";
import { getItemCount } from "./inventory";
import { getPlaces, saveCraftingTableLocation } from "../managers/persistenceManager";
import { currentDimension } from "./perception";
import {
  getInventoryCounts,
  getNearestBlock,
  getNearestFreeSpace,
} from "./world";

/*
Possible Scenarios:

1. **Successful Craft Without Crafting Table**: 
   - The bot attempts to craft the item without a crafting table and succeeds. The function returns `true`.

2. **Crafting Table Nearby**:
   - The bot tries to craft without a crafting table but fails.
   - The bot then checks for a nearby crafting table.
   - If a crafting table is found, the bot moves to it and successfully crafts the item, returning `true`.

3. **No Crafting Table Nearby, Place Crafting Table**:
   - The bot fails to craft without a crafting table and does not find a nearby crafting table.
   - The bot checks inventory for a crafting table, places it at a suitable location, and attempts crafting again.
   - If successful, the function returns `true`. If the bot cannot find a suitable position or fails to craft, it returns `false`.

4. **Insufficient Resources**:
   - At any point, if the bot does not have the required resources to craft the item, it logs an appropriate message and returns `false`.

5. **No Crafting Table and No Suitable Position**:
   - If the bot does not find a crafting table and cannot find a suitable position to place one, it moves away and returns `false`.

6. **Invalid Item Name**:
   - If the provided item name is invalid, the function logs the error and returns `false`.
*/
// Crafting tables the bot couldn't walk to recently (skipped for a while)
const unreachableTables = new Map<string, number>();
const UNREACHABLE_FOR_MS = 5 * 60 * 1000;
const MAX_TABLES_TRIED = 3;
const tableKey = (b: Block): string => `${b.position.x},${b.position.y},${b.position.z}`;

/** Crafting tables nearby, nearest first, minus the ones it recently couldn't reach. */
function nearbyTables(range: number): Block[] {
  const id = bot.registry.blocksByName["crafting_table"]?.id;
  if (id === undefined) return [];
  const now = Date.now();
  return bot
    .findBlocks({ matching: id, maxDistance: range, count: 16 })
    .map((p) => bot.blockAt(p))
    .filter((b): b is Block => b !== null && (unreachableTables.get(tableKey(b)) ?? 0) < now)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
}

const HOME_RADIUS = 24;
/** A crafting table this close is walked to; a new one is placed only with none this close. */
export const TABLE_RANGE = 50;


/**
 * A crafting table within `range`: one in sight (loaded), or one it
 * remembers placing that is still there or out of sight. Null when none.
 */
export function tableNear(range: number): Vec3 | null {
  const id = bot.registry.blocksByName["crafting_table"]?.id;
  const here = bot.entity.position;
  const seen = id === undefined ? null : bot.findBlock({ matching: id, maxDistance: range });
  if (seen) return seen.position;
  const dim = currentDimension();
  for (const t of getPlaces("crafting_table")) {
    if ((t.dimension ?? dim) !== dim) continue;
    const at = new Vec3(t.x, t.y, t.z);
    if (here.distanceTo(at) > range) continue;
    const block = bot.blockAt(at);
    // Out of sight (not loaded) counts; loaded and gone doesn't
    if (!block || block.name === "crafting_table") return at;
  }
  return null;
}

const FAR_TABLE_RANGE = 256;

/** The nearest table it remembers placing within `range` (any distance it would walk back), or null. */
function rememberedTable(range: number): Vec3 | null {
  const dim = currentDimension();
  const here = bot.entity.position;
  return (
    getPlaces("crafting_table")
      .filter((t) => (t.dimension ?? dim) === dim)
      .map((t) => new Vec3(t.x, t.y, t.z))
      .filter((p) => p.distanceTo(here) <= range && (bot.blockAt(p)?.name ?? "crafting_table") === "crafting_table")
      .sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0] ?? null
  );
}

/** The shelter's table spot, when it's near and free (air) right now. */
function homeTableSpot(): Vec3 | null {
  const dim = currentDimension();
  const room = getPlaces("basement").filter((p) => p.dimension === dim && p.details?.["incomplete"] !== true).at(-1);
  const spot = room?.details?.["table"] as { x: number; y: number; z: number } | undefined;
  if (!spot || bot.entity.position.distanceTo(new Vec3(spot.x, spot.y, spot.z)) > HOME_RADIUS) return null;
  return bot.blockAt(new Vec3(spot.x, spot.y, spot.z))?.name === "air" ? new Vec3(spot.x, spot.y, spot.z) : null;
}


export async function craftRecipe(
  incomingItemName: string,
  num = 1
): Promise<boolean> {
  let itemName = incomingItemName.replace(" ", "_").toLowerCase();

  if (itemName.endsWith("plank")) itemName += "s"; // Correct common mistakes

  const foundItemId = gameData.getItemId(itemName);
  if (foundItemId === null) {
    console.log(`Invalid item name: ${itemName}`);
    return false;
  }
  const itemId: number = foundItemId; // narrowed for use inside closures

  // No free slot and no stack to add to: the crafted item would have nowhere to go and be lost
  if (bot.inventory.emptySlotCount() === 0 && !bot.inventory.items().some((i) => i.type === itemId && i.count < i.stackSize)) {
    console.log(`Can't craft ${itemName}: my inventory is full (the result would be lost).`);
    return false;
  }

  // Helper function to attempt crafting
  async function attemptCraft(
    recipes: Recipe[] | null,
    craftingTable: Block | null = null
  ): Promise<boolean> {
    if (recipes && recipes.length > 0) {
      const recipe = recipes[0];
      // bot.craft's count is how many times to run the recipe, not how many
      // items to make: one stick recipe yields 4 sticks, so 12 sticks = 3 crafts
      const perCraft = recipe.result?.count ?? 1;
      const times = Math.max(1, Math.ceil(num / perCraft));
      // Checked: a time limit on the crafting window, and the items must appear
      const made = await craftWith(recipe, times, craftingTable);
      if (!made.ok) {
        console.log(`Failed to craft ${itemName}: ${describeFailure(made)}`);
        return false;
      }
      console.log(`Successfully crafted ${made.value} ${itemName}${craftingTable ? " using crafting table" : ""}.`);
      return true;
    }
    // Say why a craft at a table failed (without a table, 3x3 recipes failing is expected)
    if (craftingTable) {
      const carried = bot.inventory.items().map((i) => `${i.count} ${i.name}`).join(", ");
      console.log(`No ${itemName} recipe fits the inventory at the crafting table. Carrying: ${carried || "nothing"}.`);
    }
    return false;
  }

  // Helper function to move to a crafting table and attempt crafting with retry logic
  async function moveToAndCraft(craftingTable: Block): Promise<boolean> {
    console.log(`Crafting table at ${craftingTable.position}, moving to it.`);
    try {
      // One walk: pathing already retries when a reflex (creeper, fight) cuts
      // in. Into real reach of the table (the long-trip walker counts close
      // sideways as there: it stood on a tree 3 blocks up and every craft
      // failed "out of my reach", fresh-world test)
      if (!withinReach(craftingTable.position)) {
        const p = craftingTable.position;
        const near = await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 2));
        if (!near.ok && !withinReach(p)) {
          const far = await goToPosition(p.x, p.y, p.z, 1);
          if (far) await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 2));
        }
      }
      // Opening the table only works within reach; don't wait 20 s on a
      // window that can't open
      if (!withinReach(craftingTable.position)) return false;
      const recipes = bot.recipesFor(itemId, null, 1, craftingTable);
      return await attemptCraft(recipes, craftingTable);
    } catch (err) {
      console.log(`Using the crafting table failed: ${(err as Error).message}`);
      return false;
    }
  }

  // Helper function to find and use or place a crafting table
  async function findAndUseCraftingTable(
    craftingTableRange: number
  ): Promise<boolean> {
    // Use a table already there: the nearest ones the bot can walk to
    const tables = nearbyTables(craftingTableRange).slice(0, MAX_TABLES_TRIED);
    for (const table of tables) {
      if (await moveToAndCraft(table)) return true;
      if (withinReach(table.position)) {
        // Reached it and still couldn't craft: another table won't help
        console.log(`Couldn't craft ${itemName} at the crafting table at ${table.position}.`);
        return false;
      }
      // A short walk found no way (from inside its shelter, fresh-world
      // test): the long way, in legs, before giving up on it
      const p = table.position;
      const walked = await travelToResult(() => ({ x: p.x, y: p.y, z: p.z }), { range: 2 });
      if (walked.ok && (await moveToAndCraft(table))) return true;
      unreachableTables.set(tableKey(table), Date.now() + UNREACHABLE_FOR_MS);
      console.log(`Can't get to the crafting table at ${table.position}.`);
    }
    // Owner's rule: never a second table with one within TABLE_RANGE, even
    // one it can't get to right now (it placed a new one 16 blocks from its
    // first when the walk from its shelter timed out)
    const near = tableNear(TABLE_RANGE);
    if (near) {
      // One it remembers but can't see from here (out of sight): walk there first
      if (!tables.some((t) => t.position.equals(near))) {
        const walked = await travelToResult(() => ({ x: near.x, y: near.y, z: near.z }), { range: 2 });
        const there = bot.blockAt(near);
        if (walked.ok && there?.name === "crafting_table" && (await moveToAndCraft(there))) return true;
      }
      console.log(`There's a crafting table at ${near} already (within ${TABLE_RANGE}) that I can't get to; I won't place another, so no ${itemName} for now.`);
      return false;
    }
    console.log(`No crafting table within ${TABLE_RANGE}, using my own.`);

    // Our own table, only with no table within TABLE_RANGE it can reach: put
    // it down and leave it there. Made from
    // what it carries (planks or logs) if needed, but never by going to get
    // wood: that's the planner's job (skills/acquire), which asks for a table first
    if (getItemCount("crafting_table") === 0 && !(await craftNow("crafting_table", 1)).ok) {
      // Nothing to make one from (deep in its mine, its pickaxe worn out):
      // back to a table it knows, however far, like a player going home
      const home = rememberedTable(FAR_TABLE_RANGE);
      if (home) {
        console.log(`No crafting table here and nothing to make one; going to mine at ${home}.`);
        const walked = await travelToResult(() => ({ x: home.x, y: home.y, z: home.z }), { range: 2 });
        const there = bot.blockAt(home);
        if (walked.ok && there?.name === "crafting_table") return moveToAndCraft(there);
      }
      console.log(`No crafting table, and nothing to make one from, to craft ${itemName}.`);
      return false;
    }
    // At home its table has a spot in the shelter (the owner's layout)
    const pos = homeTableSpot() ?? getNearestFreeSpace(1, 10);
    if (!pos) {
      console.log("No suitable position found to place the crafting table.");
      return false;
    }
    console.log(`Placing crafting table at position (${pos.x}, ${pos.y}, ${pos.z}).`);
    await placeBlock("crafting_table", pos.x, pos.y, pos.z);
    // Use the table we just placed, not whichever one is "nearest"
    const placed = bot.blockAt(pos);
    if (placed?.name !== "crafting_table") {
      console.log("Placing the crafting table failed.");
      return false;
    }
    try {
      return await moveToAndCraft(placed);
    } finally {
      // It stays where it is, always, and is remembered (owner: never pick
      // the crafting table back up; the next craft walks to it)
      await saveCraftingTableLocation({ x: placed.position.x, y: placed.position.y, z: placed.position.z });
      console.log(`Leaving my crafting table at ${placed.position}.`);
    }
  }

  // Step 1: Try to craft without a crafting table
  console.log(`Step 1: Try to craft without a crafting table`);
  let recipes = bot.recipesFor(itemId, null, 1, null);
  if (recipes && (await attemptCraft(recipes))) {
    return true;
  }

  // Step 2: Find and use a crafting table
  console.log(`Step 2: Find and use a crafting table`);
  // Any table within 50 blocks is used (walked to) rather than placing another (owner's rule)
  const craftingTableRange = TABLE_RANGE;
  if (await findAndUseCraftingTable(craftingTableRange)) {
    return true;
  }

  return false;
}

export async function smeltItem(itemName: string, num = 1): Promise<boolean> {
  const foods = [
    "beef",
    "chicken",
    "cod",
    "mutton",
    "porkchop",
    "rabbit",
    "salmon",
    "tropical_fish",
  ];
  if (!itemName.includes("raw") && !foods.includes(itemName)) {
    console.log(
      `Cannot smelt ${itemName}, must be a "raw" item, like "raw_iron".`
    );
    return false;
  } // TODO: allow cobblestone, sand, clay, etc.

  let placedFurnace = false;
  let furnaceBlock = getNearestBlock("furnace", 32);
  if (!furnaceBlock) {
    // Try to place furnace
    const hasFurnace = getInventoryCounts()["furnace"] > 0;
    if (hasFurnace) {
      const pos = getNearestFreeSpace(1, 32);
      if (pos) {
        await placeBlock("furnace", pos.x, pos.y, pos.z);
      } else {
        console.log("No suitable position found to place the furnace.");
        return false;
      }
      furnaceBlock = getNearestBlock("furnace", 32);
      placedFurnace = true;
    }
  }
  if (!furnaceBlock) {
    console.log(`There is no furnace nearby and I have no furnace.`);
    return false;
  }
  if (!withinReach(furnaceBlock.position)) {
    const p = furnaceBlock.position;
    const walked = await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 3));
    if (!walked.ok) {
      console.log(`Can't get to the furnace: ${describeFailure(walked)}`);
      if (placedFurnace) await collectBlock("furnace", 1);
      return false;
    }
  }

  console.log("smelting...");
  const opened = await openFurnaceAt(furnaceBlock);
  if (!opened.ok) {
    console.log(`Couldn't open the furnace: ${describeFailure(opened)}`);
    if (placedFurnace) await collectBlock("furnace", 1);
    return false;
  }
  const furnace = opened.value;
  let total = 0;
  let smeltedItem: Item | null = null;
  try {
    // Check if the furnace is already smelting something
    const inputItem = furnace.inputItem();
    if (inputItem && inputItem.type !== gameData.getItemId(itemName) && inputItem.count > 0) {
      console.log(`The furnace is currently smelting ${gameData.getItemName(inputItem.type)}.`);
      return false;
    }
    // Check if the bot has enough items to smelt
    const invCounts = getInventoryCounts();
    if (!invCounts[itemName] || invCounts[itemName] < num) {
      console.log(`I do not have enough ${itemName} to smelt.`);
      return false;
    }
    // Fuel the furnace
    if (!furnace.fuelItem()) {
      const fuel = bot.inventory.items().find((item) => item.name === "coal" || item.name === "charcoal");
      const putFuel = Math.ceil(num / 8);
      if (!fuel || fuel.count < putFuel) {
        console.log(`I do not have enough coal or charcoal to smelt ${num} ${itemName}, I need ${putFuel} coal or charcoal`);
        return false;
      }
      const fueled = await windowStep("fuelling the furnace", () => furnace.putFuel(fuel.type, null, putFuel));
      if (!fueled.ok) {
        console.log(`Couldn't fuel the furnace: ${describeFailure(fueled)}`);
        return false;
      }
      console.log(`Added ${putFuel} ${gameData.getItemName(fuel.type)} to furnace fuel.`);
    }
    // Put the items in the furnace
    const itemId = gameData.getItemId(itemName);
    if (itemId === null) {
      console.log(`Invalid item name: ${itemName}`);
      return false;
    }
    const loaded = await windowStep(`putting ${itemName} in`, () => furnace.putInput(itemId, null, num));
    if (!loaded.ok) {
      console.log(`Couldn't put ${itemName} in the furnace: ${describeFailure(loaded)}`);
      return false;
    }
    // Wait for the items to smelt
    let collectedLast = true;
    await new Promise((resolve) => setTimeout(resolve, 200));
    while (total < num) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      if (isCommandCancelled()) break; // stopped: take what's done and close the furnace
      console.log("checking...");
      let collected = false;
      if (furnace.outputItem()) {
        const taken = await windowStep("taking the output", () => furnace.takeOutput());
        if (taken.ok && taken.value) {
          smeltedItem = taken.value;
          total += taken.value.count;
          collected = true;
        }
      }
      if (!collected && !collectedLast) break; // nothing this time or last time
      collectedLast = collected;
    }
  } finally {
    closeWindow(furnace);
    if (placedFurnace) await collectBlock("furnace", 1);
  }

  if (total === 0) {
    console.log(`Failed to smelt ${itemName}.`);
    return false;
  }
  if (total < num) {
    console.log(`Only smelted ${total} ${gameData.getItemName(smeltedItem?.type || 0)}.`);
    return false;
  }
  console.log(`Successfully smelted ${itemName}, got ${total} ${gameData.getItemName(smeltedItem?.type || 0)}.`);
  return true;
}

export async function clearNearestFurnace(): Promise<boolean> {
  const furnaceBlock = getNearestBlock("furnace", 6);
  if (!furnaceBlock) {
    console.log(`There is no furnace nearby.`);
    return false;
  }

  console.log("clearing furnace...");
  if (!withinReach(furnaceBlock.position)) {
    const p = furnaceBlock.position;
    const walked = await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 3));
    if (!walked.ok) {
      console.log(`Can't get to the furnace: ${describeFailure(walked)}`);
      return false;
    }
  }
  const opened = await openFurnaceAt(furnaceBlock);
  if (!opened.ok) {
    console.log(`Couldn't open the furnace: ${describeFailure(opened)}`);
    return false;
  }
  const furnace = opened.value;
  const got: string[] = [];
  try {
    // Take the items out of the furnace
    for (const [label, has, take] of [
      ["smelted items", () => furnace.outputItem(), () => furnace.takeOutput()],
      ["input items", () => furnace.inputItem(), () => furnace.takeInput()],
      ["fuel items", () => furnace.fuelItem(), () => furnace.takeFuel()],
    ] as const) {
      if (!has()) {
        got.push(`0 ${label}`);
        continue;
      }
      const taken = await windowStep(`taking the ${label}`, take);
      got.push(taken.ok && taken.value ? `${taken.value.count} ${taken.value.name}` : `0 ${label}`);
    }
  } finally {
    closeWindow(furnace);
  }
  console.log(`Cleared furnace, received ${got.join(", ")}.`);
  return true;
}
