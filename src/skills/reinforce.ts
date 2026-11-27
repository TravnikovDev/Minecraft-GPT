// Path: src/skills/reinforce.ts
// A stone shelter, like a player (owner: reinforce the shelter's walls with
// smooth stone; a low-priority job, smooth stone only, and only once it has
// two stacks of coal for the furnace: see the stone_shelter milestone). Its
// shelter is dug into the ground, so its walls, roof and floor are whatever
// was there: dirt, grass, sand, gravel, snow, planks it patched with. A
// creeper blows those out (blast resistance under 1; stone is 6). Each weak
// block of the shell is broken and smelted stone put in its place, one at a
// time, by day, never leaving a hole (game test: the smooth stone wouldn't
// stay over its doors, and two holes were left in its shelter's front).

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

/** True when every block of its shelter's shell is loaded (in sight): only then does "nothing weak" mean it. */
export function shelterSeen(): boolean {
  const home = shelterLayout();
  return home !== null && home.shell.every((p) => shellCellAt(p) !== null);
}

const count = (name: string): number => bot.inventory.items().filter((i) => i.name === name).reduce((n, i) => n + i.count, 0);

// What it builds with (owner: smooth stone only, never a mix with stone or cobblestone)
const BUILD_WITH = "smooth_stone";

/**
 * Smooth stone for `n` cells, carried or from its chests: never smelted on
 * the spot (it stood at the furnace for minutes, and dusk ended it each
 * time); the workshop makes it in the background.
 */
async function getSmoothStone(n: number): Promise<void> {
  if (count(BUILD_WITH) >= n) return;
  const { storedNear, takeItems } = await import("../actions/storage");
  if (storedNear(BUILD_WITH, 32) > 0) await takeItems([{ name: BUILD_WITH, count: n - count(BUILD_WITH) }], true);
}

/** True when the block over `p` is the top half of a door: the cell over a door is left (smooth stone didn't stay there). */
const overADoor = (p: P3): boolean => /_door$/.test(knownBlock(new Vec3(p.x, p.y - 1, p.z))?.name ?? "");

/**
 * Reinforces its shelter: each weak block of its walls, roof, floor and
 * stairs broken and stone put in its place. By day only (a wall is open for
 * a moment). Done over a few visits for a big shelter.
 */
export async function reinforceShelter(byDay: boolean): Promise<ActionResult> {
  const cells = shelterWeakCells();
  if (cells.length === 0) return ok();
  if (!byDay) return fail("refused", "the shelter's walls are changed by day");
  await getSmoothStone(Math.min(cells.length, PER_RUN));
  // As many cells as it has smooth stone for (a short batch now, more next time)
  const batch = cells.filter((p) => !overADoor(p)).slice(0, Math.min(PER_RUN, count(BUILD_WITH)));
  if (batch.length === 0) return count(BUILD_WITH) === 0 ? fail("missing_items", "no smooth stone to reinforce my shelter with") : ok();
  report(`Reinforcing my shelter: ${batch.length} weak block${batch.length === 1 ? "" : "s"} of dirt and the like to change for smooth stone.`);
  const { breakBlock } = await import("../core/primitives");
  const { placeBlockResult } = await import("../actions/blockPlacing");
  let done = 0;
  for (const p of batch) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    if (count(BUILD_WITH) === 0) break;
    const at = new Vec3(p.x, p.y, p.z);
    // Sand or gravel over it would drop in: left as it is
    const old = knownBlock(at)?.name ?? "";
    if (FALLING.has(knownBlock(at.offset(0, 1, 0))?.name ?? "")) continue;
    if (!(await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 3))).ok) continue;
    const broken = await breakBlock(at, { allowWithoutHarvest: true });
    if (!broken.ok) continue;
    const placed = await placeBlockResult(BUILD_WITH, p.x, p.y, p.z, "side");
    if (placed.ok) {
      done++;
      continue;
    }
    console.log(`Reinforcing: couldn't put smooth stone at ${at}: ${describeFailure(placed)}; putting the ${old} back.`);
    // Never a hole: what was there back (it's just been picked up), else any filler it has
    const back = [old, "dirt", "cobblestone", "stone"].find((n) => n && count(n) > 0);
    if (back && (await placeBlockResult(back, p.x, p.y, p.z, "side")).ok) continue;
    console.log(`Reinforcing: the hole at ${at} stays open (nothing to fill it with); the shelter's patching mends it.`);
  }
  // Anything it broke and couldn't fill is the shelter's patching job (night: it mends it)
  const { pickupNearbyItems } = await import("../actions/pickup");
  await pickupNearbyItems(bot, 6);
  if (done > 0) chatter(`Reinforced ${done} block${done === 1 ? "" : "s"} of my shelter with smooth stone.`, "reinforce");
  // Out of smooth stone with weak cells left: done for now (more is made in the background)
  if (count(BUILD_WITH) === 0) return ok();
  const left = shelterWeakCells().length;
  return left === 0 ? ok() : fail("not_found", `${left} weak block${left === 1 ? "" : "s"} of my shelter left to reinforce`);
}
