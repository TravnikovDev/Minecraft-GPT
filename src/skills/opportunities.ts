// Path: src/skills/opportunities.ts
// Noticing chances, like a player (owner: "during idle he needs to scan the
// surroundings and find something cool, put priorities on his actions"). When
// it isn't busy with something urgent, it looks around for ores it can see
// and can mine with the pickaxe it has, and puts "mine that" on the task list
// with a priority that fits what it is: iron and better go ahead of the next
// milestone (bucket 5, front), coal and copper wait for a quiet moment
// (bucket 6). The arbiter decides when each runs, as for every other task.

import type { Block } from "prismarine-block";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { Bucket, currentTask, pendingTasks, propose } from "../core/arbiter";
import { areChoresMuted } from "../core/chores";
import { forbiddenAt } from "../core/forbidden";
import { chatter } from "../core/narrator";
import { canSee, openFaces, type SightWorld } from "../actions/sight";
import { tunnelBlocked } from "../actions/digging";
import { mayWanderTo } from "../actions/pickup";
import { collectBlock } from "../actions/collectBlock";

const LOOK_RANGE = 12;
const FAILED_FOR_MS = 10 * 60_000;
const TASK_PREFIX = "mining the ";
// Best first (by what it drops): what a player goes for when they spot it
const ORE_RANK = ["diamond", "emerald", "gold", "iron", "redstone", "lapis", "copper", "coal"];
// This good or better cuts ahead of the next milestone; the rest waits for a quiet moment
const GOES_FIRST = ORE_RANK.indexOf("iron");

const failed = new Map<string, number>();
const keyOf = (b: Block): string => `${b.position.x},${b.position.y},${b.position.z}`;

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
    .filter((b) => (failed.get(keyOf(b)) ?? 0) < now && !forbiddenAt(b.position) && tunnelBlocked(b.position) === null && mayWanderTo(b.position));
  candidates.sort((a, b) => oreRank(oreKind(a.name)!) - oreRank(oreKind(b.name)!) || a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
  return candidates[0] ?? null;
}

const alreadyOnIt = (): boolean =>
  (currentTask()?.name.startsWith(TASK_PREFIX) ?? false) || pendingTasks().some((t) => t.name.startsWith(TASK_PREFIX));

/**
 * Called every few seconds: when nothing urgent is going on (no owner's
 * command, no reflex, no night routine), an ore in sight goes on the task
 * list at the priority it deserves.
 */
export function considerOpportunities(): void {
  if (!bot.entity || areChoresMuted() || alreadyOnIt()) return;
  const running = currentTask();
  if (running && running.bucket < Bucket.Self) return; // the owner's command, a threat, upkeep: not now
  const ore = bestOreInSight();
  if (!ore) return;
  const kind = oreKind(ore.name)!;
  const first = oreRank(kind) <= GOES_FIRST;
  const name = `${TASK_PREFIX}${ore.name.replace(/_/g, " ")} I saw`;
  console.log(`Opportunity: ${ore.name} in sight at ${ore.position}; ${first ? "before my next milestone" : "when I'm free"}.`);
  propose(
    {
      name,
      bucket: first ? Bucket.Self : Bucket.Idle,
      run: async () => {
        chatter(`There's ${kind} ore right there; mining it.`, "opportunity");
        const got = await collectBlock(ore.name, 8, LOOK_RANGE + 4, { seenOnly: true });
        if (got === 0) failed.set(keyOf(ore), Date.now() + FAILED_FOR_MS);
      },
    },
    { front: first }
  );
}

/** Forgets ores it failed at (a new connection; tests). */
export function resetOpportunities(): void {
  failed.clear();
}
