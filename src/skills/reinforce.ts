// Path: src/skills/reinforce.ts
// A stone shelter, like a player (owner: once 200 cobblestone have piled up,
// smelt it into smooth stone and reinforce the shelter's walls with it). Its
// shelter is dug into the ground, so its walls, roof and floor are whatever
// was there: dirt, grass, sand, gravel, snow, planks it patched with. A
// creeper blows those out (blast resistance under 1; stone is 6). Each weak
// block of the shell is broken and smelted stone put in its place, one at a
// time, by day; cobblestone when it runs out of stone (the same blast
// resistance).

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { goTo, knownBlock } from "../core/primitives";
import { fail, ok, describeFailure, type ActionResult } from "../core/result";
import { isCommandCancelled } from "../core/commandContext";
import { chatter, report } from "../core/narrator";
import { shelterLayout } from "../actions/building";

// Stone's blast resistance: anything under it is weak
const STRONG = 6;
// Blocks it changes in one go (a long job is done over a few visits)
const PER_RUN = 48;
// Falling blocks: one over a cell it breaks drops into it
const FALLING = new Set(["sand", "red_sand", "gravel", "suspicious_sand", "suspicious_gravel"]);

type P3 = { x: number; y: number; z: number };
/** A shell cell as the check sees it (null: not loaded). */
export type ShellCell = { name: string; solid: boolean; resistance: number } | null;

/**
 * The shell cells to reinforce: solid blocks weaker than stone. Open cells
 * are the shelter's patching job, not this one. Pure over `look`.
 */
export function weakCells(shell: P3[], look: (p: P3) => ShellCell): P3[] {
  return shell.filter((p) => {
    const c = look(p);
    return c !== null && c.solid && c.resistance < STRONG && c.name !== "bedrock";
  });
}

/** The live view of a shell cell. */
function shellCellAt(p: P3): ShellCell {
  const b = knownBlock(new Vec3(p.x, p.y, p.z));
  if (!b) return null;
  const resistance = Number((bot.registry.blocksByName[b.name] as { resistance?: number } | undefined)?.resistance ?? 0);
  // Its doors and the like aren't part of this: only full blocks
  return { name: b.name, solid: b.boundingBox === "block" && !b.name.endsWith("_door"), resistance };
}

/** Its shelter's weak cells now. */
export function shelterWeakCells(): P3[] {
  const home = shelterLayout();
  return home ? weakCells(home.shell, shellCellAt) : [];
}

const count = (name: string): number => bot.inventory.items().filter((i) => i.name === name).reduce((n, i) => n + i.count, 0);

// What it builds with, best first (owner: smooth stone, smelted twice from
// cobblestone; then stone, then cobblestone, all the same blast resistance)
const BUILD_WITH = ["smooth_stone", "stone", "cobblestone"];

/** Smooth stone for `n` cells: carried, from its chests, or smelted (cobblestone to stone to smooth stone). */
async function getSmoothStone(n: number): Promise<void> {
  if (count("smooth_stone") >= n) return;
  const { storedNear, takeItems } = await import("../actions/storage");
  if (storedNear("smooth_stone", 32) > 0) await takeItems([{ name: "smooth_stone", count: n - count("smooth_stone") }], true);
  if (count("smooth_stone") >= n) return;
  const { acquire } = await import("./acquire");
  const { liveWorld } = await import("./world");
  const made = await acquire("smooth_stone", n, liveWorld);
  if (!made.ok) console.log(`Reinforcing: only ${count("smooth_stone")} smooth stone (${describeFailure(made)}); stone or cobblestone for the rest.`);
}

/**
 * Reinforces its shelter: each weak block of its walls, roof, floor and
 * stairs broken and stone put in its place. By day only (a wall is open for
 * a moment). Done over a few visits for a big shelter.
 */
export async function reinforceShelter(byDay: boolean): Promise<ActionResult> {
  const cells = shelterWeakCells();
  if (cells.length === 0) return ok();
  if (!byDay) return fail("refused", "the shelter's walls are changed by day");
  const batch = cells.slice(0, PER_RUN);
  await getSmoothStone(batch.length);
  if (BUILD_WITH.every((n) => count(n) === 0)) return fail("missing_items", "no smooth stone, stone or cobblestone to reinforce my shelter with");
  report(`Reinforcing my shelter: ${cells.length} weak block${cells.length === 1 ? "" : "s"} of dirt and the like to change for smooth stone.`);
  const { breakBlock } = await import("../core/primitives");
  const { placeBlockResult } = await import("../actions/blockPlacing");
  let done = 0;
  for (const p of batch) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    const block = BUILD_WITH.find((n) => count(n) > 0) ?? null;
    if (!block) break;
    const at = new Vec3(p.x, p.y, p.z);
    // Sand or gravel over it would drop in: left as it is
    if (FALLING.has(knownBlock(at.offset(0, 1, 0))?.name ?? "")) continue;
    if (!(await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 3))).ok) continue;
    const broken = await breakBlock(at, { allowWithoutHarvest: true });
    if (!broken.ok) continue;
    const placed = await placeBlockResult(block, p.x, p.y, p.z, "side");
    if (placed.ok) done++;
    else console.log(`Reinforcing: couldn't put ${block} at ${at}: ${describeFailure(placed)}.`);
  }
  // Anything it broke and couldn't fill is the shelter's patching job (night: it mends it)
  const { pickupNearbyItems } = await import("../actions/pickup");
  await pickupNearbyItems(bot, 6);
  if (done > 0) chatter(`Reinforced ${done} block${done === 1 ? "" : "s"} of my shelter with smooth stone.`, "reinforce");
  const left = shelterWeakCells().length;
  return left === 0 ? ok() : fail("not_found", `${left} weak block${left === 1 ? "" : "s"} of my shelter left to reinforce`);
}
