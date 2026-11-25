// Path: src/skills/mine.ts
// The bot's mine (owner's design): from the exit in the shelter room's far
// wall, a diagonal staircase 10 levels down, then branch mining at the bottom
// like a player: the main tunnel goes on 3 blocks at a time, with side
// tunnels 5 long to the left and right, and the ores it uncovers (coal, iron)
// are mined as it goes. Progress is remembered with the mine, so the next
// trip carries on where the last one stopped.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import { bot } from "../core/body";
import { goTo } from "../core/primitives";
import { fail, ok, type ActionResult } from "../core/result";
import { isCommandCancelled } from "../core/commandContext";
import { chatter, report } from "../core/narrator";
import { addPlace, getPlaces } from "../managers/persistenceManager";
import { currentDimension } from "../actions/perception";
import { digDiagonalTunnel, digStraightTunnel, type DirectionType } from "../actions/digging";
import { collectBlock } from "../actions/collectBlock";
import { ensurePickaxe } from "../actions/ensureTools";
import { shelterSlots } from "../actions/building";
import { catalog } from "../core/catalog";

export const MINE_DEPTH = 10;
const BRANCH_EVERY = 3;
const BRANCH_LENGTH = 5;
const MAX_BRANCHES = 24; // about 72 blocks of main tunnel: plenty for a first mine
const ORE_REACH = 6; // ores this close to a fresh tunnel get mined
const MINE_NAME = "shelter mine";

const STEP: Record<DirectionType, Vec3> = { north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), east: new Vec3(1, 0, 0), west: new Vec3(-1, 0, 0) };
const LEFT: Record<DirectionType, DirectionType> = { north: "west", west: "south", south: "east", east: "north" };
const RIGHT: Record<DirectionType, DirectionType> = { north: "east", east: "south", south: "west", west: "north" };

type Pos = { x: number; y: number; z: number };

/** Where the stairs from `exit` going `dir` end (pure: tested on its own). */
export function mineBottom(exit: Pos, dir: DirectionType): Vec3 {
  return new Vec3(exit.x, exit.y, exit.z).plus(STEP[dir].scaled(MINE_DEPTH)).offset(0, -MINE_DEPTH, 0);
}

/** Branch `k` (1, 2, ...): where the main tunnel is then, and the two side directions. */
export function branchAt(bottom: Pos, dir: DirectionType, k: number): { main: Vec3; left: DirectionType; right: DirectionType } {
  return { main: new Vec3(bottom.x, bottom.y, bottom.z).plus(STEP[dir].scaled(BRANCH_EVERY * k)), left: LEFT[dir], right: RIGHT[dir] };
}

/** Its mine under the shelter, if dug: the bottom of the stairs, the direction and branches done. */
export function myMine(): { bottom: Vec3; direction: DirectionType; branches: number; start: Pos } | null {
  const dim = currentDimension();
  const mine = getPlaces("mine").find((m) => m.name === MINE_NAME && m.dimension === dim);
  if (!mine) return null;
  const d = (mine.details ?? {}) as { direction?: DirectionType; endsAt?: Pos; branches?: number };
  if (!d.direction || !d.endsAt) return null;
  return { bottom: new Vec3(d.endsAt.x, d.endsAt.y, d.endsAt.z), direction: d.direction, branches: d.branches ?? 0, start: { x: mine.x, y: mine.y, z: mine.z } };
}

/** Digs the stairs down from the shelter's exit (once). */
export async function digMine(): Promise<ActionResult> {
  if (myMine()) return ok();
  const slots = shelterSlots();
  if (!slots?.exit || !slots.direction) return fail("not_found", "no shelter with an exit to start a mine from");
  if (!(await ensurePickaxe())) return fail("no_tool", "no pickaxe to dig a mine");
  const exit = new Vec3(slots.exit.x, slots.exit.y, slots.exit.z);
  const inside = await goTo(new pf.goals.GoalBlock(slots.stand.x, slots.stand.y, slots.stand.z));
  if (!inside.ok) return inside;
  report(`Digging my mine: ${MINE_DEPTH} levels down from the back of my shelter.`);
  // The diagonal tunnel saves itself as a mine (start, end, direction, depth)
  if (!(await digDiagonalTunnel(slots.direction, MINE_DEPTH, { width: 1, height: 2 }, exit, MINE_NAME))) {
    return fail("refused", "the mine's stairs hit lava, water or something built");
  }
  return myMine() ? ok() : fail("error", "the mine wasn't remembered");
}

/** Carried count of these items. */
const carried = (names: string[]): number => bot.inventory.items().filter((i) => names.includes(i.name)).reduce((n, i) => n + i.count, 0);

/** What a mining trip is after: the item an ore drops, and how many of it are enough. */
export type OreWant = { item: string; enough: number; counts: string[] };
export const COAL: OreWant = { item: "coal", enough: 16, counts: ["coal", "charcoal"] };
export const IRON: OreWant = { item: "raw_iron", enough: 6, counts: ["raw_iron", "iron_ingot"] };

/**
 * Branch mining until it has enough of what it wants (or a few branches more
 * if this trip finds nothing): main tunnel 3 on, a side tunnel each way, and
 * the ores those uncover.
 */
export async function branchMine(wants: OreWant[], branchesThisTrip = 6): Promise<ActionResult> {
  const mine = myMine();
  if (!mine) return fail("not_found", "no mine yet");
  if (!(await ensurePickaxe())) return fail("no_tool", "no pickaxe to mine with");
  const still = (): OreWant[] => wants.filter((w) => carried(w.counts) < w.enough);
  if (still().length === 0) return ok();

  // Down the stairs to where the last trip stopped
  const from = mine.branches > 0 ? branchAt(mine.bottom, mine.direction, mine.branches).main : mine.bottom;
  const there = await goTo(new pf.goals.GoalBlock(from.x, from.y, from.z));
  if (!there.ok) return there;

  for (let i = 0; i < branchesThisTrip && still().length > 0; i++) {
    if (isCommandCancelled()) return fail("aborted", "stopped");
    const k = mine.branches + 1;
    if (k > MAX_BRANCHES) return fail("not_found", `my mine is ${MAX_BRANCHES} branches long and still not enough ${still().map((w) => w.item.replace(/_/g, " ")).join(" or ")}`);
    const before = branchAt(mine.bottom, mine.direction, k - 1).main;
    const at = branchAt(mine.bottom, mine.direction, k);
    if (!(await digStraightTunnel(mine.direction, BRANCH_EVERY, before, 1))) return fail("refused", "the main tunnel hit lava, water or something built");
    // Side tunnels: a lava or water stop just ends that side
    for (const side of [at.left, at.right]) {
      if (isCommandCancelled()) return fail("aborted", "stopped");
      await digStraightTunnel(side, BRANCH_LENGTH, at.main, 1);
      await goTo(new pf.goals.GoalBlock(at.main.x, at.main.y, at.main.z));
    }
    mine.branches = k;
    await addPlace({
      kind: "mine",
      name: MINE_NAME,
      dimension: currentDimension(),
      ...mine.start,
      details: { direction: mine.direction, depth: MINE_DEPTH, endsAt: { x: mine.bottom.x, y: mine.bottom.y, z: mine.bottom.z }, branches: k },
    });
    // What the new tunnels uncovered (ores only: stone comes from the digging itself)
    for (const want of still().filter((w) => isOre(w.item))) {
      const got = await collectBlock(want.item, want.enough - carried(want.counts), ORE_REACH);
      if (got > 0) chatter(`Found ${want.item.replace(/_/g, " ")}: ${carried(want.counts)} of ${want.enough}.`, "mining");
    }
  }
  return still().length === 0 ? ok() : fail("missing_items", `not enough ${still().map((w) => w.item.replace(/_/g, " ")).join(" or ")} yet (I'll mine on next time)`);
}

/** An item ores drop (coal, raw iron), as opposed to plain stone. */
function isOre(item: string): boolean {
  return item !== "cobblestone" && catalog().oresFor(item).length > 0;
}

/**
 * Gets about `count` more of `item` (cobblestone, coal, raw iron...) the way
 * a player does: down its mine, carrying on with the tunnel. Digs the mine's
 * stairs first if it has none (those alone give plenty of cobblestone).
 */
export async function mineFor(item: string, count: number): Promise<ActionResult> {
  const counts = item === "coal" ? COAL.counts : item === "raw_iron" ? IRON.counts : [item];
  const target = carried(counts) + count;
  if (!myMine()) {
    const dug = await digMine();
    if (!dug.ok) return dug;
    if (carried(counts) >= target) return ok();
  }
  return branchMine([{ item, enough: target, counts }], 12);
}
