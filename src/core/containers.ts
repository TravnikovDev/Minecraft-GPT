// Path: src/core/containers.ts
// Opening chests and barrels and moving exact item stacks in and out, checked
// (Phase 3): opening has a time limit, every transfer is paced (servers like
// Paper kick players who click windows too fast) and recounted afterwards, so
// "stored 12 coal" means 12 coal really left the inventory.

import type { Block } from "prismarine-block";
import type { Item } from "prismarine-item";
import type { Furnace } from "mineflayer";
import { bot } from "./body";
import { guarded } from "./guard";
import { paceClicks } from "./pace";
import { beginUse, waitTurn } from "./leases";
import { currentSignal } from "./commandContext";
import { syncInventory, withinReach } from "./primitives";
import { fail, ok, type ActionResult } from "./result";

/** An open chest or barrel. */
export type OpenContainer = {
  /** What's inside the container (not the bot's own inventory). */
  containerItems(): Item[];
  /** Container slots (27 for a chest, 54 for a double chest). */
  inventoryStart: number;
  close(): Promise<void> | void;
  /** Moves `count` of this exact item (same NBT: durability, enchantments) into the container. */
  deposit(itemType: number, metadata: number | null, count: number | null, nbt?: unknown): Promise<void>;
  /** Moves `count` of this exact item from the container to the bot. */
  withdraw(itemType: number, metadata: number | null, count: number | null, nbt?: unknown): Promise<void>;
  /** The bot's own items as this window shows them (mineflayer's bot.inventory catches up only when it closes). */
  items?(): Item[];
};

/**
 * How many of `name` the bot carries while `open` is open. mineflayer moves
 * items in the window's copy of the inventory and copies it back to
 * bot.inventory on close: counting bot.inventory said every deposit "didn't
 * go in" when it had.
 */
function carriedWhileOpen(open: OpenContainer, name: string): number {
  const items = typeof open.items === "function" ? open.items() : bot.inventory.items();
  return items.filter((i) => i.name === name).reduce((n, i) => n + i.count, 0);
}

/** Blocks the bot uses for storage. */
export const STORAGE_BLOCKS = new Set(["chest", "trapped_chest", "barrel"]);

const OPEN_TIMEOUT_MS = 5_000;
const TRANSFER_TIMEOUT_MS = 5_000;
const CONFIRM_MS = 1_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));


async function until(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(50);
  }
  return check();
}

/** Opens a chest or barrel within reach, with a time limit. */
async function openStorageNow(block: Block): Promise<ActionResult<OpenContainer>> {
  if (!STORAGE_BLOCKS.has(block.name)) return fail("not_found", `${block.name} is not a chest or barrel`);
  if (!withinReach(block.position)) return fail("out_of_reach", `${block.name} at ${block.position}`);
  await paceClicks();
  return guarded(`opening the ${block.name}`, async () => (await bot.openContainer(block)) as unknown as OpenContainer, {
    timeoutMs: OPEN_TIMEOUT_MS,
    onStop: () => {
      if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
    },
  });
}

/** Closes an open container (never throws). */
export async function closeStorage(open: OpenContainer): Promise<void> {
  try {
    await open.close();
  } catch (error) {
    console.log(`Closing the container failed: ${(error as Error).message}`);
  }
}

/** Free container slots (empty ones; partly filled stacks are extra room). */
export function freeContainerSlots(open: OpenContainer): number {
  return open.inventoryStart - open.containerItems().length;
}

/** How many of `item` still fit in the container (empty slots plus room in matching stacks). */
function roomInContainer(open: OpenContainer, item: { type: number; stackSize: number }): number {
  const inStacks = open
    .containerItems()
    .filter((i) => i.type === item.type)
    .reduce((n, i) => n + Math.max(0, i.stackSize - i.count), 0);
  return freeContainerSlots(open) * item.stackSize + inStacks;
}

/** Puts `count` of the exact stack `item` (from the bot's inventory) in the container, and recounts. */
async function depositIntoNow(open: OpenContainer, item: Item, count: number): Promise<ActionResult<number>> {
  const n = Math.min(count, item.count);
  if (roomInContainer(open, item) < n) return fail("full", "the chest is full");
  const before = carriedWhileOpen(open, item.name);
  await paceClicks();
  const done = await guarded(`storing ${item.name}`, () => open.deposit(item.type, null, n, item.nbt ?? undefined), {
    timeoutMs: TRANSFER_TIMEOUT_MS,
  });
  if (!done.ok) return done;
  await syncInventory(open); // the server's view, not mineflayer's optimistic one
  if (!(await until(() => carriedWhileOpen(open, item.name) <= before - n, CONFIRM_MS))) {
    const moved = before - carriedWhileOpen(open, item.name);
    return moved > 0 ? ok(moved) : fail("refused", `the ${item.name} didn't go in`);
  }
  return ok(n);
}

/** Takes `count` of the exact stack `item` (from the container) into the bot's inventory, and recounts. */
async function withdrawFromNow(open: OpenContainer, item: Item, count: number): Promise<ActionResult<number>> {
  const n = Math.min(count, item.count);
  const room =
    bot.inventory.emptySlotCount() * item.stackSize +
    bot.inventory.items().filter((i) => i.type === item.type).reduce((r, i) => r + Math.max(0, i.stackSize - i.count), 0);
  if (room === 0) return fail("full", "my inventory is full");
  const take = Math.min(n, room);
  const before = carriedWhileOpen(open, item.name);
  await paceClicks();
  const done = await guarded(`taking ${item.name}`, () => open.withdraw(item.type, null, take, item.nbt ?? undefined), {
    timeoutMs: TRANSFER_TIMEOUT_MS,
  });
  if (!done.ok) return done;
  await syncInventory(open); // the server's view, not mineflayer's optimistic one
  if (!(await until(() => carriedWhileOpen(open, item.name) >= before + take, CONFIRM_MS))) {
    const moved = carriedWhileOpen(open, item.name) - before;
    return moved > 0 ? ok(moved) : fail("refused", `the ${item.name} didn't come out`);
  }
  return ok(take);
}

// --- Furnaces and other windows ------------------------------------------------

/** An open furnace window (mineflayer's Furnace). */
export type OpenFurnace = Furnace;

/** Opens a furnace (or smoker, blast furnace) within reach, with a time limit. */
async function openFurnaceAtNow(block: Block): Promise<ActionResult<OpenFurnace>> {
  if (!withinReach(block.position)) return fail("out_of_reach", `${block.name} at ${block.position}`);
  await paceClicks();
  return guarded(`opening the ${block.name}`, () => bot.openFurnace(block), {
    timeoutMs: OPEN_TIMEOUT_MS,
    onStop: () => {
      if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
    },
  });
}

/**
 * One click-step in an open window (put fuel in, take the output...), paced
 * and with a time limit, so a server that never answers can't hang the bot.
 */
export async function windowStep<T>(label: string, step: () => Promise<T>): Promise<ActionResult<T>> {
  await paceClicks();
  return guarded(label, step, { timeoutMs: TRANSFER_TIMEOUT_MS });
}

/** Closes any open window (never throws). */
export function closeWindow(window: { id?: number } | null | undefined): void {
  try {
    if (window) bot.closeWindow(window as never);
  } catch (error) {
    console.log(`Closing the window failed: ${(error as Error).message}`);
  }
}

/** openStorage, waiting its turn while a reflex or a borrower has the body (core/leases). */
export async function openStorage(block: Block): Promise<ActionResult<OpenContainer>> {
  const signal = currentSignal();
  for (const r of ["window", "hands"] as const) {
    if (!(await waitTurn(r, () => Boolean(signal?.aborted)))) return fail("aborted", "stopped while waiting for my turn");
  }
  const ends = [beginUse("window"), beginUse("hands")];
  try {
    return await openStorageNow(block);
  } finally {
    for (const end of ends) end();
  }
}

/** depositInto, waiting its turn while a reflex or a borrower has the body (core/leases). */
export async function depositInto(open: OpenContainer, item: Item, count: number): Promise<ActionResult<number>> {
  const signal = currentSignal();
  for (const r of ["window", "hands"] as const) {
    if (!(await waitTurn(r, () => Boolean(signal?.aborted)))) return fail("aborted", "stopped while waiting for my turn");
  }
  const ends = [beginUse("window"), beginUse("hands")];
  try {
    return await depositIntoNow(open, item, count);
  } finally {
    for (const end of ends) end();
  }
}

/** withdrawFrom, waiting its turn while a reflex or a borrower has the body (core/leases). */
export async function withdrawFrom(open: OpenContainer, item: Item, count: number): Promise<ActionResult<number>> {
  const signal = currentSignal();
  for (const r of ["window", "hands"] as const) {
    if (!(await waitTurn(r, () => Boolean(signal?.aborted)))) return fail("aborted", "stopped while waiting for my turn");
  }
  const ends = [beginUse("window"), beginUse("hands")];
  try {
    return await withdrawFromNow(open, item, count);
  } finally {
    for (const end of ends) end();
  }
}

/** openFurnaceAt, waiting its turn while a reflex or a borrower has the body (core/leases). */
export async function openFurnaceAt(block: Block): Promise<ActionResult<OpenFurnace>> {
  const signal = currentSignal();
  for (const r of ["window", "hands"] as const) {
    if (!(await waitTurn(r, () => Boolean(signal?.aborted)))) return fail("aborted", "stopped while waiting for my turn");
  }
  const ends = [beginUse("window"), beginUse("hands")];
  try {
    return await openFurnaceAtNow(block);
  } finally {
    for (const end of ends) end();
  }
}
