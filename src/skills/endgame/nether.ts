// Path: src/skills/endgame/nether.ts
// The Nether (Phase 9): a fortress found by walking out from its portal in
// legs until nether bricks are in sight (remembered, and the way home is the
// portal it came through); blaze rods from the blazes by a fortress's
// spawner (it backs off and eats when hurt); ender pearls from piglins for
// gold (in gold armour, so they stay friendly).

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import type { Entity } from "prismarine-entity";
import { bot } from "../../core/body";
import { isCommandCancelled } from "../../core/commandContext";
import { fighting } from "../../core/plugins";
import { equipItem, goTo, lookAt, tossStack } from "../../core/primitives";
import { fail, ok, type ActionResult } from "../../core/result";
import { chatter, report } from "../../core/narrator";
import { count, dimensionNow, endgame, goToDimension, noteEndgame } from "./state";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// Health below this: off from the fight to eat and heal
const RETREAT_HEALTH = 10;

/** Nether bricks in sight (a fortress), if any. */
function fortressInSight(): Vec3 | null {
  const id = bot.registry.blocksByName["nether_bricks"]?.id;
  return id === undefined ? null : (bot.findBlock({ matching: id, maxDistance: 64 })?.position ?? null);
}

/** Finds a fortress: in sight, or by walking out in legs from here (the Nether only). */
export async function findFortress(): Promise<ActionResult> {
  if (endgame().fortress) return ok();
  const went = await goToDimension("the_nether");
  if (!went.ok) return went;
  const { exploreFor } = await import("../explore");
  for (let trip = 0; trip < 4 && !isCommandCancelled(); trip++) {
    const seen = fortressInSight();
    if (seen) {
      await noteEndgame({ fortress: { x: seen.x, y: seen.y, z: seen.z } });
      report(`Found a Nether fortress at ${seen.x}, ${seen.y}, ${seen.z}!`);
      return ok();
    }
    await exploreFor("a fortress", () => fortressInSight() !== null, 4);
  }
  const seen = fortressInSight();
  if (seen) {
    await noteEndgame({ fortress: { x: seen.x, y: seen.y, z: seen.z } });
    return ok();
  }
  return fail("not_found", "no fortress in four trips out from my portal");
}

const isBlaze = (e: Entity): boolean => e.name === "blaze";

/** Backs off from the fight and eats until health is back up. */
async function recover(from: Vec3): Promise<void> {
  fighting.stop();
  const me = bot.entity.position;
  const away = me.minus(from).normalize().scaled(12).plus(me);
  await goTo(new pf.goals.GoalNear(away.x, away.y, away.z, 3));
  const { eatWhenHungry } = await import("../../actions/upkeep");
  for (let i = 0; i < 20 && bot.health < 16 && !isCommandCancelled(); i++) {
    await eatWhenHungry();
    await sleep(1_500);
  }
}

/** Blaze rods: waits by the fortress's blaze spawner and fights the blazes that come near (`want`: more rods). */
export async function getBlazeRods(want: number): Promise<ActionResult> {
  if (want <= 0) return ok();
  const goal = count("blaze_rod") + want;
  const found = await findFortress();
  if (!found.ok) return found;
  const f = endgame().fortress!;
  const spawnerId = bot.registry.blocksByName["spawner"]?.id;
  await goTo(new pf.goals.GoalNear(f.x, f.y, f.z, 4));
  const spawner = spawnerId === undefined ? null : bot.findBlock({ matching: spawnerId, maxDistance: 48 });
  const post = spawner ? spawner.position : new Vec3(f.x, f.y, f.z);
  // Near the spawner, not on it (blazes spawn around it)
  await goTo(new pf.goals.GoalNear(post.x, post.y, post.z, 6));
  const { attackEntity } = await import("../../actions/combat");
  const { pickupNearbyItems } = await import("../../actions/pickup");
  const until = Date.now() + 10 * 60_000;
  chatter("Waiting for blazes by the spawner.", "blazes");
  const { holdPosition } = await import("../../managers/stuckWatch");
  while (!isCommandCancelled() && Date.now() < until && count("blaze_rod") < goal) {
    holdPosition(5_000); // waiting for blazes is standing still on purpose
    if (bot.health < RETREAT_HEALTH) {
      await recover(post);
      await goTo(new pf.goals.GoalNear(post.x, post.y, post.z, 6));
      continue;
    }
    const blaze = bot.nearestEntity((e) => isBlaze(e) && e.position.distanceTo(bot.entity.position) < 16);
    if (blaze && blaze.position.distanceTo(bot.entity.position) < 4) {
      await attackEntity(blaze, false);
      await sleep(600);
    } else {
      await sleep(500);
    }
    if (!blaze || !bot.entities[blaze.id]) await pickupNearbyItems(bot, 8);
  }
  fighting.stop();
  await pickupNearbyItems(bot, 8);
  const have = count("blaze_rod");
  return have >= goal ? ok() : fail("missing_items", `only ${have} of ${goal} blaze rods`);
}

/** Wears a golden helmet (piglins attack a player without gold armour). */
async function wearGold(): Promise<ActionResult> {
  const gold = ["golden_helmet", "golden_boots", "golden_chestplate", "golden_leggings"];
  const worn = bot.inventory.slots.slice(5, 9).some((i) => i && gold.includes(i.name));
  if (worn) return ok();
  if (count("golden_helmet") === 0) {
    const { acquire } = await import("../acquire");
    const { liveWorld } = await import("../world");
    const made = await acquire("golden_helmet", 1, liveWorld);
    if (!made.ok) return made;
  }
  return equipItem("golden_helmet", "head");
}

/**
 * Ender pearls by bartering: one gold ingot thrown to a piglin at a time,
 * then what it gives back picked up. Gold armour on, so they stay friendly.
 */
export async function barterForPearls(want: number): Promise<ActionResult> {
  if (dimensionNow() !== "the_nether") return fail("refused", "piglins are in the Nether");
  if (count("gold_ingot") === 0) return fail("missing_items", "no gold ingots to trade");
  const armour = await wearGold();
  if (!armour.ok) return armour;
  const { pickupNearbyItems } = await import("../../actions/pickup");
  let tries = 0;
  while (count("ender_pearl") < want && count("gold_ingot") > 0 && tries++ < 64 && !isCommandCancelled()) {
    const piglin = bot.nearestEntity((e) => e.name === "piglin" && e.position.distanceTo(bot.entity.position) < 32);
    if (!piglin) return fail("not_found", "no piglin near to trade with");
    await goTo(new pf.goals.GoalFollow(piglin, 3));
    await lookAt(piglin.position.offset(0, 1, 0));
    const ingot = bot.inventory.items().find((i) => i.name === "gold_ingot");
    if (!ingot) break;
    await tossStack(ingot, 1);
    await sleep(8_000); // a piglin looks at gold for about six seconds
    await pickupNearbyItems(bot, 8);
  }
  return count("ender_pearl") >= want ? ok() : fail("missing_items", `only ${count("ender_pearl")} of ${want} ender pearls from trading`);
}
