// Path: src/actions/placeCheck.ts
// Remembered places are checked against the world (Phase 5): a crafting
// table, furnace, chest or bed it remembers that isn't there any more is
// forgotten, either the moment the bot sees the block change, or the first
// time it comes near after a restart. A block that isn't loaded is unknown,
// never "gone". The base and mines are spots, not blocks: they're kept.

import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { on } from "../core/events";
import { forgetChest, loadBed, loadChests, saveBed } from "../core/session";
import { forgetPlaces, getPlaces, type Place } from "../managers/persistenceManager";
import { currentDimension } from "./perception";

const NEAR = 16;
const STORAGE = new Set(["chest", "trapped_chest", "barrel"]);
const FURNACES = new Set(["furnace", "blast_furnace", "smoker"]);

/** Whether a block still is what was remembered there. */
export function stillThere(kind: "crafting_table" | "furnace" | "chest" | "bed", blockName: string): boolean {
  if (kind === "crafting_table") return blockName === "crafting_table";
  if (kind === "furnace") return FURNACES.has(blockName);
  if (kind === "chest") return STORAGE.has(blockName);
  return catalog().isBed(blockName);
}

const checkedThisSession = new Set<string>();
const key = (p: { x: number; y: number; z: number }): string => `${p.x},${p.y},${p.z}`;
const same = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
const checkable = (p: Place): p is Place & { kind: "crafting_table" | "furnace" } => p.kind === "crafting_table" || p.kind === "furnace";

/** Forgets what's remembered at `pos` if the block there (now `blockName`) isn't it any more. */
async function verify(pos: { x: number; y: number; z: number }, blockName: string): Promise<void> {
  for (const p of getPlaces().filter((p) => checkable(p) && same(p, pos))) {
    if (!stillThere(p.kind as "crafting_table" | "furnace", blockName)) {
      await forgetPlaces((q) => q.kind === p.kind && same(q, pos));
      console.log(`The ${p.kind.replace(/_/g, " ")} at ${key(pos)} is gone (${blockName} now); forgetting it.`);
    }
  }
  const chest = loadChests().find((c) => same(c, pos));
  if (chest && !stillThere("chest", blockName)) {
    await forgetChest(pos);
    console.log(`The chest at ${key(pos)} is gone; forgetting it.`);
  }
  const bed = loadBed();
  if (bed && same(bed, pos) && !stillThere("bed", blockName)) {
    await saveBed(null);
    console.log(`My bed at ${key(pos)} is gone; forgetting it.`);
  }
}

/** Called every few seconds: the first time near a remembered place, checks it's still there. */
export async function checkPlacesNearby(): Promise<void> {
  if (!bot.entity) return;
  const me = bot.entity.position;
  const dim = currentDimension();
  const near = (p: { x: number; y: number; z: number; dimension: string }): boolean =>
    p.dimension === dim && !checkedThisSession.has(key(p)) && me.distanceTo(new Vec3(p.x, p.y, p.z)) <= NEAR;
  const spots = [
    ...getPlaces().filter(checkable).filter(near),
    ...loadChests().filter(near),
    ...[loadBed()].filter((b): b is NonNullable<typeof b> => b !== null && near(b)),
  ];
  for (const spot of spots) {
    const block = bot.blockAt(new Vec3(spot.x, spot.y, spot.z));
    if (!block) continue; // not loaded: unknown, check later
    checkedThisSession.add(key(spot));
    await verify(spot, block.name);
  }
}

/** A new connection: check everything again as the bot comes near. */
export function resetPlaceChecks(): void {
  checkedThisSession.clear();
}

// Seen to change (broken by someone, or by the bot): check right away
on("block:changed", ({ position, to }) => {
  void verify({ x: position.x, y: position.y, z: position.z }, to);
});
