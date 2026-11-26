// Path: src/skills/endgame/state.ts
// The late game's memory (Phase 9) and the dimension helpers every stage
// uses: where its portals are on each side, the fortress and stronghold it
// found, when it first did each big thing, and going between dimensions
// through the portals it knows.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { bot } from "../../core/body";
import { goTo } from "../../core/primitives";
import { fail, ok, type ActionResult } from "../../core/result";
import { getMemory, updateMemory } from "../../managers/persistenceManager";
import type { P3 } from "./geometry";

export type Dimension = "overworld" | "the_nether" | "the_end";
export type Endgame = {
  overworldPortal?: P3;
  netherPortal?: P3;
  fortress?: P3;
  stronghold?: P3;
  endPortal?: P3;
  netherVisited?: number;
  endVisited?: number;
  dragonDefeated?: number;
  cameHome?: number;
  /** Eyes thrown so far: where from and which way each flew (kept between tries). */
  throws?: { x: number; z: number; dx: number; dz: number; down: boolean }[];
  /** End portal frame blocks that already have an eye. */
  framesFilled?: number;
};

/** What it knows about the late game so far. */
export function endgame(): Endgame {
  return (getMemory().endgame as Endgame | undefined) ?? {};
}

/** Remembers more about the late game (merged). */
export async function noteEndgame(patch: Partial<Endgame>): Promise<void> {
  await updateMemory({ endgame: { ...endgame(), ...patch } });
}

/** The dimension it's in ("minecraft:the_nether" and "the_nether" alike). */
export function dimensionNow(): Dimension {
  const d = String((bot.game as { dimension?: string }).dimension ?? "overworld").replace(/^minecraft:/, "");
  return d === "the_nether" || d === "the_end" ? d : "overworld";
}

/** How many of these items it carries. */
export const count = (...names: string[]): number => bot.inventory.items().filter((i) => names.includes(i.name)).reduce((n, i) => n + i.count, 0);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Waits until it's in `dim` (a portal takes a few seconds), up to `ms`. */
export async function waitForDimension(dim: Dimension, ms = 20_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (dimensionNow() === dim && bot.entity) return true;
    await sleep(500);
  }
  return dimensionNow() === dim;
}

/** True when it stands in a Nether portal block now. */
const inPortal = (): boolean => bot.blockAt(bot.entity.position.floored())?.name === "nether_portal";

/**
 * Relights a portal whose inside cell is `cell` when it's gone out (a ghast's
 * fireball puts one out): flint and steel on the obsidian under it.
 */
async function relight(cell: P3): Promise<void> {
  const here = bot.blockAt(new Vec3(cell.x, cell.y, cell.z));
  const under = bot.blockAt(new Vec3(cell.x, cell.y - 1, cell.z));
  if (!here || here.name === "nether_portal" || under?.name !== "obsidian" || count("flint_and_steel") === 0) return;
  const { equipItem, useBlock } = await import("../../core/primitives");
  await goTo(new pf.goals.GoalNear(cell.x, cell.y, cell.z, 2));
  if ((await equipItem("flint_and_steel")).ok) await useBlock(under);
  await sleep(800);
  console.log(`Relit the portal at ${cell.x}, ${cell.y}, ${cell.z}: ${bot.blockAt(new Vec3(cell.x, cell.y, cell.z))?.name}.`);
}

/** Walks into the portal whose inside cell is `cell` and waits to come out in `to`. */
export async function throughPortal(cell: P3, to: Dimension): Promise<ActionResult> {
  // Standing in a portal already (just came through it): it won't take it
  // back until it has stepped out once
  if (inPortal()) {
    await goTo(new pf.goals.GoalInvert(new pf.goals.GoalNear(cell.x, cell.y, cell.z, 2)));
    await sleep(1_000);
  }
  await relight(cell);
  const walked = await goTo(new pf.goals.GoalBlock(cell.x, cell.y, cell.z));
  if (!walked.ok && bot.entity.position.distanceTo(new Vec3(cell.x, cell.y, cell.z)) > 1.5) return walked;
  // Standing in the portal: it takes about 4 seconds to go through
  return (await waitForDimension(to)) ? ok() : fail("refused", `the portal at ${cell.x}, ${cell.y}, ${cell.z} didn't take me`);
}

/**
 * What it takes into the Nether: flint and steel (to relight the way home),
 * a gold helmet when it has the gold (piglins leave a player in gold alone),
 * blocks to bridge and wall off with. Best effort: it says what's missing.
 */
async function packNetherKit(): Promise<void> {
  const { acquire } = await import("../acquire");
  const { liveWorld } = await import("../world");
  const missing: string[] = [];
  if (count("flint_and_steel") === 0 && !(await acquire("flint_and_steel", 1, liveWorld)).ok) missing.push("flint and steel");
  const goldOn = bot.inventory.slots.some((i) => i?.name.startsWith("golden_"));
  if (!goldOn && count("golden_helmet") === 0 && count("gold_ingot") >= 5) await acquire("golden_helmet", 1, liveWorld);
  if (count("golden_helmet") === 0 && !goldOn) missing.push("a gold helmet");
  if (count("cobblestone", "cobbled_deepslate", "dirt") < 32) await acquire("cobblestone", 32, liveWorld);
  if (missing.length > 0) console.log(`Nether: going without ${missing.join(" or ")}.`);
}

/**
 * Gets it to the Nether or the overworld through the portals it knows
 * (the End is only reached through the stronghold: see stronghold.ts).
 */
export async function goToDimension(dim: "overworld" | "the_nether"): Promise<ActionResult> {
  const now = dimensionNow();
  if (now === dim) return ok();
  const e = endgame();
  if (now === "the_end") return fail("refused", "I can only leave the End through its exit portal once the dragon is dead");
  const portal = dim === "the_nether" ? e.overworldPortal : e.netherPortal;
  if (!portal) return fail("not_found", dim === "the_nether" ? "I have no Nether portal yet" : "I don't know where my portal home is");
  if (dim === "the_nether") await packNetherKit();
  const went = await throughPortal(portal, dim);
  if (went.ok && dim === "the_nether") {
    const { wearBestArmor } = await import("../../actions/armor");
    await wearBestArmor(); // the gold helmet goes on in the Nether
  }
  return went;
}

/**
 * Remembers where it comes out of a portal, however it went through (on
 * purpose, or by stumbling in): the Nether side is the way home.
 */
export function registerPortalWatch(): void {
  bot.on("respawn", () => {
    setTimeout(() => {
      if (!bot.entity || !inPortal()) return; // a death's respawn, not a portal
      const p = bot.entity.position.floored();
      const spot = { x: p.x, y: p.y, z: p.z };
      const dim = dimensionNow();
      const e = endgame();
      if (dim === "the_nether") void noteEndgame({ netherPortal: spot, netherVisited: e.netherVisited ?? Date.now() });
      else if (dim === "overworld" && !e.overworldPortal) void noteEndgame({ overworldPortal: spot });
    }, 1_500);
  });
}
