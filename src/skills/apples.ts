// Path: src/skills/apples.ts
// Apples from oak leaves when it's starving (owner: if the bot is starving
// and oak trees are near, it can get apples from them). Oak and dark oak
// leaves drop an apple one time in 200, broken or decaying, so this is a
// last resort: a bounded number of natural leaves (never ones a player
// placed), stopping once it has a couple of apples.

import pf from "mineflayer-pathfinder";
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
export async function applesFromLeaves(): Promise<number> {
  const ids = APPLE_LEAVES.map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  const leaves = bot
    .findBlocks({ matching: ids, maxDistance: 24, count: MAX_LEAVES })
    .map((p) => bot.blockAt(p))
    .filter((b): b is NonNullable<typeof b> => b !== null && naturalLeaves(b.getProperties()) && !forbiddenAt(b.position));
  if (leaves.length === 0) return 0;
  chatter("I'm starving; picking through the oak leaves round here for apples.", "food");
  const { breakBlock } = await import("../core/primitives");
  const { pickupNearbyItems } = await import("../actions/pickup");
  const start = apples();
  const until = Date.now() + MAX_MS;
  let broken = 0;
  for (const leaf of leaves) {
    if (apples() - start >= ENOUGH_APPLES || Date.now() > until || isCommandCancelled()) break;
    if (!(await goTo(new pf.goals.GoalNear(leaf.position.x, leaf.position.y, leaf.position.z, 3))).ok) continue;
    if ((await breakBlock(leaf.position, { allowWithoutHarvest: true })).ok) broken++;
    if (broken % 8 === 0) await pickupNearbyItems(bot, 5);
  }
  await pickupNearbyItems(bot, 6);
  const got = apples() - start;
  console.log(`Apples: broke ${broken} oak leaves, got ${got} apple${got === 1 ? "" : "s"}.`);
  return got;
}
