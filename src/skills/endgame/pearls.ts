// Path: src/skills/endgame/pearls.ts
// Ender pearls (Phase 9), two ways: trading gold with piglins in the Nether
// (when it has gold enough), or hunting endermen, which come out on the
// surface at night. Then the eyes of ender: blaze powder from the rods, an
// eye from a pearl and powder.

import pf from "mineflayer-pathfinder";
import { bot } from "../../core/body";
import { isCommandCancelled } from "../../core/commandContext";
import { fighting } from "../../core/plugins";
import { goTo } from "../../core/primitives";
import { describeFailure, fail, ok, type ActionResult } from "../../core/result";
import { count, dimensionNow, goToDimension } from "./state";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// Gold worth taking to the piglins: a trade gives pearls about 1 time in 20
// (some 16 gold per pearl), so 32 gold is a top-up of a pearl or two;
// endermen are the main source
const GOLD_FOR_TRADING = 32;

/** Hunts endermen around here (they're out at night): fights each until it drops its pearl. */
async function huntEndermen(want: number): Promise<ActionResult> {
  const { attackEntity } = await import("../../actions/combat");
  const { pickupNearbyItems } = await import("../../actions/pickup");
  const { exploreFor, inSight } = await import("../explore");
  const until = Date.now() + 10 * 60_000;
  while (count("ender_pearl") < want && Date.now() < until && !isCommandCancelled()) {
    const enderman = bot.nearestEntity((e) => e.name === "enderman" && e.position.distanceTo(bot.entity.position) < 48);
    if (!enderman) {
      if (!(await exploreFor("endermen", () => inSight((n) => n === "enderman"), 2))) await sleep(5_000);
      continue;
    }
    await goTo(new pf.goals.GoalFollow(enderman, 2));
    await attackEntity(enderman, false);
    // Fight until it's gone (dead or teleported away), then look for its pearl
    const end = Date.now() + 20_000;
    while (bot.entities[enderman.id] && Date.now() < end && !isCommandCancelled()) await sleep(400);
    fighting.stop();
    await pickupNearbyItems(bot, 10);
  }
  return count("ender_pearl") >= want ? ok() : fail("missing_items", `only ${count("ender_pearl")} of ${want} ender pearls`);
}

/** Ender pearls: by trading gold in the Nether when it has plenty, else hunting endermen. */
export async function getEnderPearls(want: number): Promise<ActionResult> {
  const have = (): number => count("ender_pearl") + count("ender_eye");
  if (have() >= want) return ok();
  if (count("gold_ingot") >= GOLD_FOR_TRADING) {
    const went = await goToDimension("the_nether");
    if (went.ok) {
      const { barterForPearls } = await import("./nether");
      const traded = await barterForPearls(want - count("ender_eye"));
      if (traded.ok || have() >= want) return ok();
      console.log(`Pearls: trading topped up to ${count("ender_pearl")} (${describeFailure(traded)}); hunting endermen for the rest.`);
    }
  }
  // Endermen: on the surface, best at night
  if (dimensionNow() !== "overworld") {
    const back = await goToDimension("overworld");
    if (!back.ok) return back;
  }
  return huntEndermen(want - count("ender_eye"));
}

/** Eyes of ender: blaze powder from rods, then an eye from each pearl and powder. */
export async function craftEyes(want: number): Promise<ActionResult> {
  if (count("ender_eye") >= want) return ok();
  const { acquire } = await import("../acquire");
  const { liveWorld } = await import("../world");
  const need = want - count("ender_eye");
  const powder = need - count("blaze_powder");
  if (powder > 0) {
    const made = await acquire("blaze_powder", powder, liveWorld);
    if (!made.ok) return fail(made.reason, `no blaze powder (${describeFailure(made)})`);
  }
  const eyes = await acquire("ender_eye", need, liveWorld);
  if (!eyes.ok && count("ender_eye") < want) return fail(eyes.reason, `only ${count("ender_eye")} of ${want} eyes of ender (${describeFailure(eyes)})`);
  return ok();
}
