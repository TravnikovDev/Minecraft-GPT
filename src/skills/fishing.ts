// Path: src/skills/fishing.ts
// Fishing for food, like a player (owner: if the bot gets string it can make
// a rod and fish during the day). A rod from 3 sticks and 2 string; then, by
// day, from the shore of open water close by (a pond, a river: never water
// in a cave, nothing hostile about), cast after cast until it has a few
// fish or time's up. The fish are cooked like any raw meat.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import type { Block } from "prismarine-block";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { equipItem, fishOnce, goTo, lookAt } from "../core/primitives";
import { isCommandCancelled } from "../core/commandContext";
import { chatter } from "../core/narrator";
import { skyAbove } from "../actions/hunting";

// How far it looks for water, and how long it fishes at most
const WATER_RANGE = 24;
const MAX_MS = 4 * 60_000;
const ENOUGH = 6;
// Nothing hostile this close (it stands still, eyes on the float)
const SAFE_RANGE = 12;
const CATCH = ["cod", "salmon", "tropical_fish", "pufferfish"];

const count = (names: string[]): number => bot.inventory.items().filter((i) => names.includes(i.name)).reduce((n, i) => n + i.count, 0);

/** True when it's day (sunset counts as evening: it's home by then). */
const daytime = (): boolean => (bot.time?.timeOfDay ?? 0) < 12_000;

/** A fishing rod in its pocket: carried, or made from 3 sticks and 2 string. */
async function haveRod(): Promise<boolean> {
  if (count(["fishing_rod"]) > 0) return true;
  if (count(["string"]) < 2) return false;
  const { acquire } = await import("./acquire");
  const { liveWorld } = await import("./world");
  const made = await acquire("fishing_rod", 1, liveWorld);
  if (made.ok) chatter("Made a fishing rod from my string.", "fishing");
  return made.ok;
}

/** A cell as the shore search sees it (null: not loaded). */
export type ShoreCell = { water: boolean; solid: boolean; open: boolean } | null;
type P3 = { x: number; y: number; z: number };

/**
 * Where to stand to fish `water` (a water source with open sky over it):
 * a solid block beside it, level with its surface, with room over it to
 * stand. Null when there's none. Pure over `look`.
 */
export function shoreFor(water: P3, look: (x: number, y: number, z: number) => ShoreCell): P3 | null {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const ground = look(water.x + dx, water.y, water.z + dz);
    const feet = look(water.x + dx, water.y + 1, water.z + dz);
    const head = look(water.x + dx, water.y + 2, water.z + dz);
    if (ground?.solid && feet?.open && head?.open) return { x: water.x + dx, y: water.y + 1, z: water.z + dz };
  }
  return null;
}

/** Open water close by to fish in: still water with sky over it and a shore beside it. */
function fishingSpot(): { water: Block; stand: P3 } | null {
  const id = bot.registry.blocksByName["water"]?.id;
  if (id === undefined) return null;
  const look = (x: number, y: number, z: number): ShoreCell => {
    const b = bot.blockAt(new Vec3(x, y, z));
    if (!b) return null;
    return { water: b.name === "water", solid: b.boundingBox === "block", open: b.boundingBox === "empty" && b.name !== "water" && b.name !== "lava" };
  };
  for (const p of bot.findBlocks({ matching: id, maxDistance: WATER_RANGE, count: 128 })) {
    const b = bot.blockAt(p);
    if (!b || Number(b.getProperties()["level"] ?? 0) !== 0) continue;
    // Open water (a pond, a river), not a cave's: the sky over it
    if (!skyAbove(p.offset(0, 1, 0), (x, y, z) => bot.blockAt(new Vec3(x, y, z)), 32)) continue;
    // And water out from the shore for the float to land in
    if (bot.blockAt(p.offset(0, -1, 0))?.name !== "water") continue;
    const stand = shoreFor(p, look);
    if (stand) return { water: b, stand };
  }
  return null;
}

/** Nothing hostile close by (it stands still with its eyes on the float). */
function safeHere(): boolean {
  return !bot.nearestEntity((e) => !!e.name && catalog().isHostile(e.name) && e.position.distanceTo(bot.entity.position) <= SAFE_RANGE);
}

/**
 * Fishes for food by day, from the shore of open water close by, with a
 * rod it has or makes from string. How many fish it caught.
 */
export async function goFishing(): Promise<number> {
  if (!daytime() || !bot.entity) return 0;
  const spot = fishingSpot();
  if (!spot) return 0;
  if (!(await haveRod())) return 0;
  if (!(await goTo(new pf.goals.GoalBlock(spot.stand.x, spot.stand.y, spot.stand.z))).ok) return 0;
  chatter("Fishing for food at the water here.", "fishing");
  const start = count(CATCH);
  const until = Date.now() + MAX_MS;
  let casts = 0;
  while (count(CATCH) - start < ENOUGH && Date.now() < until && daytime() && !isCommandCancelled()) {
    if (!safeHere()) {
      console.log("Fishing: something hostile close by; stopping.");
      break;
    }
    if (count(["fishing_rod"]) === 0 || !(await equipItem("fishing_rod")).ok) break; // the rod broke
    // Eyes on the water a couple of blocks out from the shore
    await lookAt(spot.water.position.offset(0.5, 1, 0.5));
    casts++;
    const caught = await fishOnce();
    if (!caught.ok && caught.reason !== "timeout") {
      console.log(`Fishing: ${caught.detail}.`);
      break;
    }
  }
  const got = count(CATCH) - start;
  console.log(`Fishing: ${got} fish in ${casts} casts.`);
  if (got > 0) chatter(`Caught ${got} fish.`, "fishing");
  return got;
}
