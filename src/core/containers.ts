// Path: src/core/containers.ts
// Opening chests and barrels and moving exact item stacks in and out. The
// only place outside the Body that opens containers, so every container use
// goes through one primitive (Phase 3: verified actions).

import type { Block } from "prismarine-block";
import type { Item } from "prismarine-item";
import { bot } from "./body";

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
};

/** Blocks the bot uses for storage. */
export const STORAGE_BLOCKS = new Set(["chest", "trapped_chest", "barrel"]);

/** Opens a chest or barrel the bot is standing next to. */
export async function openStorage(block: Block): Promise<OpenContainer> {
  if (!STORAGE_BLOCKS.has(block.name)) throw new Error(`${block.name} is not a chest or barrel`);
  return (await bot.openContainer(block)) as unknown as OpenContainer;
}

/** Free container slots (empty ones; partly filled stacks are extra room). */
export function freeContainerSlots(open: OpenContainer): number {
  return open.inventoryStart - open.containerItems().length;
}
