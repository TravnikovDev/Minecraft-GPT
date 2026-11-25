// Path: src/commands/Hunting.ts
// Hunting like a player: look around first, say what's there, hunt the group
// (leaving a breeding pair of each kind), pick up the drops, report the catch
// and ask whether to go on. The planning lives in actions/hunting.ts.

import { z } from "zod";
import { Bucket, currentTask } from "../core/arbiter";
import type { Entity } from "prismarine-entity";
import { bot } from "../core/body";
import { attackEntity } from "../actions/combat";
import { collectDrops } from "../actions/pickup";
import { isCommandCancelled, reportProgress } from "../core/commandContext";
import { fighting } from "../core/plugins";
import { countList, isGame, knownAnimals, lookForAnimals, planHunt, SIGHT_RANGE, KEEP_PER_KIND } from "../actions/hunting";
import { travelToResult } from "../actions/movement";
import { askOwner, tellOwner } from "../managers/ownerDialog";
import { queueCommand } from "../managers/actionManager";
import { BotCommands } from "./types";

export const description = `When user asks the bot to hunt, the bot looks around (what it can see within 60 blocks;
animals it knows are about but can't see, up to 200 blocks, it walks to first), hunts the common game animals there (cows, pigs, sheep, chickens, rabbits), or only the kind the owner names, and leaves
two of each kind so they can breed. It picks up the drops, reports what it got and asks whether to keep hunting.
Only for hunting animals; for food in general use gatherFood (farms first).
Pass count only when the owner says a number ("kill 3 sheep"); "hunt", "go hunting", "hunt some pigs" have no count.
Example: "Go hunting", "Hunt for pigs", "Kill 3 sheep", "Kill the chicken" (count 1).`;

export const parameters = z.object({
  maxDistance: z.number().nullable().describe("How far to look for animals (default 60)."),
  mobType: z
    .string()
    .nullable()
    .describe("Minecraft ID of the animal to hunt, e.g. sheep, cow, pig, chicken. Null for all common game animals."),
  count: z.number().nullable().describe("How many animals, only when the owner says a number; null otherwise."),
});

const KILL_TIMEOUT_MS = 30000;

/** Resolves true when the entity is gone (killed), false after the timeout or a stop. */
function waitUntilGone(target: Entity): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = setInterval(() => {
      const gone = !bot.entities[target.id];
      if (gone || isCommandCancelled() || Date.now() - started > KILL_TIMEOUT_MS) {
        clearInterval(check);
        if (!gone) fighting.stop();
        resolve(gone);
      }
    }, 250);
  });
}

/** Item counts in the inventory, to report what the hunt brought in. */
function inventoryCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of bot.inventory.items()) counts.set(item.name, (counts.get(item.name) ?? 0) + item.count);
  return counts;
}

/** The nearest animal it may still take (kind not yet at its limit), alive and in range. */
function nextPrey(take: Map<string, number>, taken: Map<string, number>, mobType: string | null, maxDistance: number): Entity | null {
  const wantedKinds = new Set([...take.keys()].filter((name) => (taken.get(name) ?? 0) < take.get(name)!));
  if (wantedKinds.size === 0) return null;
  const preyIds = new Set(lookForAnimals().filter((p) => wantedKinds.has(p.name) && isGame(p, mobType) && p.distance <= maxDistance).map((p) => p.id));
  return bot.nearestEntity((e) => preyIds.has(e.id));
}

export async function execute(args: any): Promise<void> {
  console.log(`Executing Hunting with args:`, args);
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for Hunting.`);
    return;
  }
  const maxDistance = Math.min(parsed.data.maxDistance ?? SIGHT_RANGE, SIGHT_RANGE);
  const mobType = parsed.data.mobType ?? null;
  const count = parsed.data.count ?? null;
  const what = mobType ? mobType.replace(/_/g, " ") : "animals"; // owner: never "game"

  // 1. Look around and say what's there. None to take in sight, but the
  // server says some are about (up to 200 blocks): walk there until they are
  let found = lookForAnimals().filter((p) => p.distance <= maxDistance);
  let plan = planHunt(found, mobType, count);
  if (plan.total === 0) {
    const inView = new Set(found.map((p) => p.id));
    const far = knownAnimals().find((p) => isGame(p, mobType) && !inView.has(p.id));
    if (far) {
      tellOwner(`No ${what} to take in sight; there's ${far.name.replace(/_/g, " ")} about ${Math.round(far.distance)} blocks away, going there.`);
      const arrived = await travelToResult(() => {
        const e = bot.entities[far.id];
        return e ? { x: e.position.x, y: e.position.y, z: e.position.z } : null;
      }, { range: 6 });
      if (isCommandCancelled()) return;
      if (!arrived.ok) console.log(`Couldn't get to the ${far.name}: ${arrived.ok ? "" : arrived.detail}.`);
      found = lookForAnimals().filter((p) => p.distance <= maxDistance);
      plan = planHunt(found, mobType, count);
    }
  }
  if (plan.seen.size === 0) {
    tellOwner(`I don't see any ${what} around here.`);
    return;
  }
  if (plan.total === 0) {
    const seenCount = [...plan.seen.values()].reduce((a, b) => a + b, 0);
    const them = seenCount === 1 ? "it" : "them";
    if (!mobType) {
      tellOwner(`I only see ${countList(plan.seen)}. I'll leave ${them} so they can breed.`);
      return;
    }
    // The owner named the kind: their call whether to take the last ones
    askOwner(`I only see ${countList(plan.seen)}; if I hunt ${them}, none are left to breed. Hunt ${them} anyway?`, async () => {
      queueCommand({
        id: crypto.randomUUID(),
        command: BotCommands.Hunting,
        priority: 3,
        retryCount: 0,
        args: { maxDistance, mobType, count: seenCount },
      });
    });
    return;
  }
  const kept = plan.keepsPairs ? `, leaving ${KEEP_PER_KIND} of each to breed` : "";
  tellOwner(`I see ${countList(plan.seen)}. Hunting ${countList(plan.take)}${kept}.`);
  console.log(`Hunt plan: ${JSON.stringify([...plan.take])}, total ${plan.total}.`);

  // 2. Hunt the group, nearest first, picking up drops after each
  const before = inventoryCounts();
  const taken = new Map<string, number>();
  let killed = 0;
  let misses = 0;
  while (killed < plan.total && misses < 3) {
    if (isCommandCancelled()) return;
    const prey = nextPrey(plan.take, taken, mobType, maxDistance);
    if (!prey?.name) break; // the rest ran off or out of sight
    console.log(`Hunting ${prey.name} (${killed + 1}/${plan.total}).`);
    if (!(await attackEntity(prey, false))) break;
    if (await waitUntilGone(prey)) {
      killed++;
      reportProgress(killed); // cut off now, it hunts only what's left
      misses = 0;
      taken.set(prey.name, (taken.get(prey.name) ?? 0) + 1);
      await collectDrops(8); // all of this kill's drops before the next animal
    } else {
      misses++;
    }
  }
  if (isCommandCancelled()) return;

  // 3. Report the catch, then ask whether to go on if there's more to take
  const after = inventoryCounts();
  const gained = new Map<string, number>();
  for (const [name, n] of after) if (n > (before.get(name) ?? 0)) gained.set(name, n - (before.get(name) ?? 0));
  const catchReport =
    killed === 0
      ? `I couldn't catch any ${what}.`
      : `Hunted ${countList(taken)}${gained.size > 0 ? `, got ${countList(gained)}` : ""}.`;

  const more = planHunt(lookForAnimals(), mobType, null);
  // Only the owner's own hunt asks to go on; its own errands (food, wool) just report
  const forOwner = currentTask()?.bucket === Bucket.Owner;
  if (more.total > 0 && forOwner) {
    askOwner(`${catchReport} I still see ${countList(more.take)} to hunt. Keep hunting?`, async () => {
      queueCommand({
        id: crypto.randomUUID(),
        command: BotCommands.Hunting,
        priority: 3,
        retryCount: 0,
        args: { maxDistance, mobType, count: null },
      });
    });
  } else if (more.total > 0) {
    tellOwner(catchReport);
  } else {
    tellOwner(`${catchReport} That's all the ${what} I can take around here.`);
  }
}
