// Path: src/skills/opportunities.ts
// Noticing chances, like a player (owner: "during idle he needs to scan the
// surroundings and find something cool, put priorities on his actions"). When
// it isn't busy with something urgent, it looks around for ores it can see
// and can mine with the pickaxe it has, and puts "mine that" on the task list
// with a priority that fits what it is: iron and better go ahead of the next
// milestone (bucket 5, front), coal and copper wait for a quiet moment
// (bucket 6). The arbiter decides when each runs, as for every other task.

import { oreCapped } from "./oreCaps";
import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import pf from "mineflayer-pathfinder";
import { Bucket, currentTask, pendingTasks, propose, type TaskSpec } from "../core/arbiter";
import { goTo } from "../core/primitives";
import { areChoresMuted } from "../core/chores";
import { forbiddenAt } from "../core/forbidden";
import { chatter } from "../core/narrator";
import { canSee, openFaces, type SightWorld } from "../actions/sight";
import { tunnelBlocked } from "../actions/digging";
import { mayWanderTo } from "../actions/pickup";
import { collectBlock } from "../actions/collectBlock";
import { isCommandCancelled } from "../core/commandContext";
import { fitForTheMine } from "./mine";
import { foodPoints, shelter } from "./capabilities";
import { inOwnPassage, whileGathering } from "../core/movements";
import { daylight } from "../core/daylight";
import { underRoof } from "../actions/placement";
import { skyAbove } from "../actions/hunting";

const LOOK_RANGE = 12;
const FAILED_FOR_MS = 10 * 60_000;
const TASK_PREFIX = "mining the ";
// Best first (by what it drops): what a player goes for when they spot it
const ORE_RANK = ["diamond", "emerald", "gold", "iron", "redstone", "lapis", "copper", "coal"];
// This good or better cuts ahead of the next milestone; the rest waits for a quiet moment
const GOES_FIRST = ORE_RANK.indexOf("iron");

const failed = new Map<string, number>();
const NEXT_TO = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
/** Well under its home's ground (in its mine or a cave). */
const underground = (): boolean => {
  const home = shelter();
  return home !== null && bot.entity.position.y < home.y - 4;
};
// Failures by area (about 4 blocks): an unreachable vein isn't retried block by block
const keyOf = (b: Block): string => `${Math.floor(b.position.x / 4)},${Math.floor(b.position.y / 4)},${Math.floor(b.position.z / 4)}`;

// It doesn't follow ore down: an ore this far below its feet is left for the
// mine (review: ore chores drew it deep, at night, with nothing to heal with)
const MAX_DROP = 6;

/** Where an ore is, as the "may I go for it now?" rule sees it. */
export type OreSpot = { day: boolean; botUnderRoof: boolean; oreUnderSky: boolean; botY: number; oreY: number };

/**
 * True when it may go for an ore now: never down past MAX_DROP below its
 * feet; at night only under ground (in its mine or a cave it's in), and
 * never for an ore out under the open sky. Pure (review).
 */
export function oreAllowedNow(s: OreSpot): boolean {
  if (s.oreY < s.botY - MAX_DROP) return false;
  if (s.day) return true;
  return s.botUnderRoof && !s.oreUnderSky;
}

/** The live view of `oreAllowedNow` for an ore block. */
function allowedNow(ore: Block): boolean {
  const look = (x: number, y: number, z: number): Block | null => bot.blockAt(new Vec3(x, y, z));
  const feet = bot.entity.position.floored();
  return oreAllowedNow({
    day: daylight(),
    botUnderRoof: underRoof(feet, (p) => bot.blockAt(p)),
    oreUnderSky: skyAbove(ore.position, look, 64),
    botY: feet.y,
    oreY: ore.position.y,
  });
}

/** The ore's kind ("deepslate_iron_ore" -> "iron"), or null for anything that isn't one. */
export function oreKind(name: string): string | null {
  const m = /^(?:deepslate_|nether_)?([a-z]+)_ore$/.exec(name);
  return m && ORE_RANK.includes(m[1]!) ? m[1]! : null;
}

/** Rank of an ore kind: 0 is best. */
export const oreRank = (kind: string): number => ORE_RANK.indexOf(kind);

/** The best pickaxe it carries (null without one). */
function bestPickaxe(): string | null {
  const c = catalog();
  return bot.inventory.items().filter((i) => c.toolKind(i.name) === "pickaxe").sort((a, b) => c.toolTier(b.name) - c.toolTier(a.name))[0]?.name ?? null;
}

/**
 * The best ore it can see from here and mine with what it carries: in plain
 * sight within LOOK_RANGE, not next to lava, not in a keep-out area, not one
 * it failed at lately, and somewhere it may wander to.
 */
export function bestOreInSight(): Block | null {
  const pickaxe = bestPickaxe();
  if (!pickaxe || !bot.entity) return null;
  const ids = Object.values(bot.registry.blocksByName)
    .filter((b) => oreKind(b.name) !== null)
    .map((b) => b.id);
  const eyes = bot.entity.position.offset(0, 1.62, 0);
  const world = bot.world as unknown as SightWorld;
  const now = Date.now();
  const candidates = bot
    .findBlocks({ matching: ids, maxDistance: LOOK_RANGE, count: 64 })
    .map((p) => bot.blockAt(p))
    .filter((b): b is Block => b !== null)
    .filter((b) => openFaces(world, b).length > 0 && canSee(world, eyes, b, LOOK_RANGE))
    .filter((b) => catalog().canHarvest(b.name, pickaxe))
    .filter((b) => (failed.get(keyOf(b)) ?? 0) < now && !forbiddenAt(b.position) && tunnelBlocked(b.position) === null && mayWanderTo(b.position))
    .filter((b) => allowedNow(b))
    // Plenty of it already (owner: no more copper past 64)
    .filter((b) => !oreCapped(b.name))
    // Down in its mine, only ore its own tunnels opened up (the floor's
    // pass mines those); never a side trip dug to ore seen in a cave (owner:
    // the mine looked worse and worse, odd cuts and pillars everywhere)
    .filter((b) => !underground() || NEXT_TO.some((d) => inOwnPassage(b.position.plus(d))));
  candidates.sort((a, b) => oreRank(oreKind(a.name)!) - oreRank(oreKind(b.name)!) || a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
  return candidates[0] ?? null;
}

/** A task for this kind of ore already running or waiting (coal waiting must not hide iron). */
const alreadyOnIt = (kind: string): boolean => {
  const mine = (name: string): boolean => name.startsWith(TASK_PREFIX) && name.includes(` ${kind} `);
  return (currentTask() ? mine(currentTask()!.name) : false) || pendingTasks().some((t) => mine(t.name));
};

/**
 * Called every few seconds: when nothing urgent is going on (no owner's
 * command, no reflex, no night routine), an ore in sight goes on the task
 * list at the priority it deserves.
 */
export function considerOpportunities(): void {
  if (!bot.entity || areChoresMuted()) return;
  const running = currentTask();
  if (running && running.bucket < Bucket.Self) return; // the owner's command, a threat, upkeep: not now
  // Not off after ore hurt or without food, like a mining trip (game test: at
  // 0 food it followed iron and diamonds down to y -44, burned in lava with
  // nothing to heal with, and died with 514 items)
  if (!fitForTheMine(bot.health, foodPoints()).ok) return;
  const ore = bestOreInSight();
  if (!ore) return;
  const kind = oreKind(ore.name)!;
  if (alreadyOnIt(kind)) return;
  const valuable = oreRank(kind) <= GOES_FIRST;
  // Cuts in at most once every few minutes: on a long walk (to sheep 160
  // blocks off) every iron ore it passed stopped it, three times in a minute
  const first = valuable && Date.now() - lastCutIn >= CUT_IN_GAP_MS;
  if (first) lastCutIn = Date.now();
  console.log(`Opportunity: ${ore.name} in sight at ${ore.position}; ${first ? "now, then back to what I was doing" : valuable ? "next, after what I'm doing" : "when I'm free"}.`);
  propose(oreTask(ore, kind, first, valuable), { front: first });
}

const CUT_IN_GAP_MS = 3 * 60_000;
let lastCutIn = 0;

/** The task for an ore it saw: walk there, mine it (and its vein), give up on that spot for a while if it can't. */
function oreTask(ore: Block, kind: string, first: boolean, valuable = first): TaskSpec {
  const spec: TaskSpec = {
    name: `${TASK_PREFIX} ${kind} ore I saw`.replace("  ", " "),
    // Iron and better that can't cut in right now waits just after the
    // current task, not with the idle chores (which never run while it has
    // milestones: a diamond it saw would have waited for ever)
    bucket: valuable ? Bucket.Self : Bucket.Idle,
    // Iron and better: worth stopping the milestone for (it carries on afterwards)
    interrupts: first,
    run: async () => {
      // It may have waited till night, or the bot moved on: still all right?
      if (!allowedNow(ore) || !fitForTheMine(bot.health, foodPoints()).ok) return;
      chatter(`There's ${kind} ore over there; mining it.`, "opportunity");
      // Where it saw it: the task may have waited, and the bot moved on
      // Gathering: its walks may cut through its mine's walls to the ore
      // (owner), and the sleeves' floor is mended after
      const got = await whileGathering(async () => {
        const near = await goTo(new pf.goals.GoalNear(ore.position.x, ore.position.y, ore.position.z, 3));
        return near.ok ? await collectBlock(ore.name, 8, LOOK_RANGE + 4, { seenOnly: true }) : 0;
      });
      if (got === 0) failed.set(keyOf(ore), Date.now() + FAILED_FOR_MS);
      if (underground() && !isCommandCancelled()) await (await import("./mine")).mendMineFloors();
      // Its scaffolding from getting there comes down again
      const { takeDownScaffolding } = await import("../actions/scaffolding");
      if (!isCommandCancelled()) await takeDownScaffolding(true);
    },
    // Cut off (by a milestone or an order): again later if the ore is still
    // there and it's still all right; coal and copper are let go (seen again
    // they're proposed again, review)
    resume: () => (valuable && bot.blockAt(ore.position)?.name === ore.name && allowedNow(ore) ? oreTask(ore, kind, false, valuable) : null),
  };
  return spec;
}

/** Forgets ores it failed at (a new connection; tests). */
export function resetOpportunities(): void {
  failed.clear();
}
