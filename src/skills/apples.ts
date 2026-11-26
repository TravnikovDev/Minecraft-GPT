// Path: src/skills/apples.ts
// Apples from oak leaves when it's starving (owner: if the bot is starving
// and oak trees are near, it can get apples from them). Oak and dark oak
// leaves drop an apple one time in 200, broken or decaying, so this is a
// last resort: a bounded number of natural leaves (never ones a player
// placed), stopping once it has a couple of apples.

import pf from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { goTo } from "../core/primitives";
import { forbiddenAt } from "../core/forbidden";
import { isCommandCancelled } from "../core/commandContext";
import { chatter } from "../core/narrator";

const APPLE_LEAVES = ["oak_leaves", "dark_oak_leaves"];
// At most this many leaves per try, and this long
// A short last try: one leaf in 200 drops an apple (game test: 207 leaves, none)
const MAX_LEAVES = 30;
const MAX_MS = 60_000;
const ENOUGH_APPLES = 2;

/** True for leaves that grew there (a player's placed leaves are "persistent" and left alone). Pure. */
export function naturalLeaves(props: Record<string, unknown>): boolean {
  return props["persistent"] !== true && props["persistent"] !== "true";
}

const apples = (): number => bot.inventory.items().filter((i) => i.name === "apple").reduce((n, i) => n + i.count, 0);

/** Breaks oak leaves round about for apples. How many apples it got. */
// One try in a while (game test: two tries 90 seconds apart, 0 apples each)
const TRY_EVERY_MS = 10 * 60_000;
let lastTry = 0;

export async function applesFromLeaves(): Promise<number> {
  if (Date.now() - lastTry < TRY_EVERY_MS) return 0;
  lastTry = Date.now();
  const ids = APPLE_LEAVES.map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  const natural = (p: { x: number; y: number; z: number }): boolean => {
    const b = bot.blockAt(new Vec3(p.x, p.y, p.z));
    return b !== null && ids.includes(b.type) && naturalLeaves(b.getProperties()) && !forbiddenAt(b.position);
  };
  if (!bot.findBlocks({ matching: ids, maxDistance: 24, count: 64 }).some(natural)) return 0;
  chatter("I'm starving; picking through the oak leaves round here for apples.", "food");
  const { breakBlock, withinReach } = await import("../core/primitives");
  const { pickupNearbyItems } = await import("../actions/pickup");
  const start = apples();
  const until = Date.now() + MAX_MS;
  let broken = 0;
  // The nearest leaves from where it stands, and every leaf in reach there
  // before it moves on (owner: it ran from tree to tree, one leaf each)
  while (broken < MAX_LEAVES && apples() - start < ENOUGH_APPLES && Date.now() < until && !isCommandCancelled()) {
    const near = bot
      .findBlocks({ matching: ids, maxDistance: 24, count: 64 })
      .filter(natural)
      .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    const p = near[0];
    if (!p) break;
    if (!withinReach(p) && !(await goTo(new pf.goals.GoalNear(p.x, p.y, p.z, 3))).ok) break;
    const inReach = near.filter((q) => withinReach(q));
    if (inReach.length === 0) break;
    for (const q of inReach) {
      if (broken >= MAX_LEAVES || isCommandCancelled()) break;
      if ((await breakBlock(q, { allowWithoutHarvest: true })).ok) broken++;
    }
    await pickupNearbyItems(bot, 5);
  }
  await pickupNearbyItems(bot, 6);
  const got = apples() - start;
  console.log(`Apples: broke ${broken} oak leaves, got ${got} apple${got === 1 ? "" : "s"}.`);
  return got;
}
