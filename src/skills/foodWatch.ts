// Path: src/skills/foodWatch.ts
// Keeping itself fed, like a player who never lets the hunger bar run out
// (game test: it starved to death twice in twenty minutes, breaking leaves
// for apples and chopping logs while its health drained, with no food on it
// and none near). Two rules, checked every few seconds:
// - starving (hunger bar 6 or less, nothing to eat on it): food now, ahead
//   of everything but survival, its owner's orders included; at night only
//   once the hunger bar is empty (out at night is a risk too);
// - running low (under RESERVE food points on it) while living its own life:
//   a restock by day, as upkeep, ahead of its milestones and the day plan.
// A try that found nothing waits a little before the next.

import { bot } from "../core/body";
import { Bucket, currentTask, pendingTasks, propose, type TaskSpec } from "../core/arbiter";
import { areChoresMuted } from "../core/chores";
import { workingTime } from "../core/daylight";
import { report } from "../core/narrator";
import { describeFailure } from "../core/result";
import { foodPoints, shelter } from "./capabilities";

// The hunger bar (of 20) at which it's starving: no sprinting, health next
const STARVING_BAR = 6;
// Food points it keeps on it (a couple of meals); below, a restock by day
const RESERVE = 10;
// After a try that found nothing
const EMERGENCY_RETRY_MS = 90_000;
const RESTOCK_RETRY_MS = 5 * 60_000;
const EMERGENCY = "starving: getting food now";
const RESTOCK = "restocking my food";
const HARVEST = "harvesting my fields";
// Between looks at its fields for a harvest
const HARVEST_EVERY_MS = 3 * 60_000;

export type FoodNeed = "emergency" | "restock" | null;

/**
 * What its food calls for now. `bar`: the hunger bar; `points`: food on it
 * ready to eat; `day`: daylight; `ownLife`: living its own life. Pure.
 */
export function foodNeed(bar: number, points: number, day: boolean, ownLife: boolean): FoodNeed {
  if (points === 0 && bar <= (day ? STARVING_BAR : 0)) return "emergency";
  if (ownLife && day && points < RESERVE) return "restock";
  return null;
}

/** Up at its home's level, not down its mine. */
const upTop = (): boolean => {
  const home = shelter();
  return home === null || bot.entity.position.y >= home.y - 3;
};

let nextTryAt = 0;
let nextHarvestAt = 0;
let toldOwner = false;

/**
 * Its fields harvested as they ripen, by day, whatever food it has (owner:
 * bigger fields and bread): ripe crops picked and replanted, the fields
 * mended and grown, the wheat baked into bread, and what's over its carried
 * stock put in its chests at home.
 */
function harvestTask(): TaskSpec {
  return {
    name: HARVEST,
    bucket: Bucket.Upkeep,
    run: async () => {
      await (await import("./mine")).upFromTheMine();
      const { tendFarm } = await import("./farm");
      const got = await tendFarm();
      const { storeFoodReserve } = await import("./milestones");
      await storeFoodReserve();
      console.log(`Fields: harvested ${got} crops.`);
    },
  };
}

const onIt = (): boolean => {
  const mine = (name: string): boolean => name === EMERGENCY || name === RESTOCK || name === HARVEST || name.includes("stocking food") || name.includes("milestone: food");
  const running = currentTask();
  return (running !== null && mine(running.name)) || pendingTasks().some((t) => mine(t.name));
};

function foodTask(need: Exclude<FoodNeed, null>): TaskSpec {
  return {
    name: need === "emergency" ? EMERGENCY : RESTOCK,
    // Starving: ahead of the owner's orders and the night routine; low: upkeep
    bucket: need === "emergency" ? Bucket.Threat : Bucket.Upkeep,
    run: async () => {
      if (need === "emergency" && !toldOwner) {
        toldOwner = true;
        report("I'm starving and have nothing to eat: getting food before anything else.");
      }
      // Food is up top: out of its mine by its own stairs first
      await (await import("./mine")).upFromTheMine();
      const { stockFood } = await import("./milestones");
      const result = await stockFood({ emergency: need === "emergency" });
      if (!result.ok) {
        nextTryAt = Date.now() + (need === "emergency" ? EMERGENCY_RETRY_MS : RESTOCK_RETRY_MS);
        console.log(`Food: ${describeFailure(result)}; again in ${need === "emergency" ? "a minute and a half" : "5 minutes"}.`);
      }
    },
  };
}

/** Called every few seconds: proposes food now when starving, a restock by day when low. */
export async function considerFood(): Promise<void> {
  if (!bot.entity || !(bot.health > 0) || areChoresMuted()) return;
  if ((bot.food ?? 20) > STARVING_BAR + 4) toldOwner = false;
  if (Date.now() < nextTryAt || onIt()) return;
  const { autonomyOn } = await import("./curriculum");
  // Food it left cooking in a furnace counts for a restock (not when starving)
  const { cookingFoodPoints } = await import("../actions/cooking");
  const points = foodPoints();
  const need = foodNeed(bot.food ?? 20, points, workingTime(), autonomyOn());
  if (need === "restock" && foodNeed(bot.food ?? 20, points + cookingFoodPoints(), true, true) === null) return;
  if (need) {
    propose(foodTask(need));
    return;
  }
  // Ripe fields by day: harvested, whatever food it carries; only while it's
  // up top (review: the harvest pulled it out of its mine every 20 minutes,
  // 2 minutes of climbing each; ripe wheat waits for the trip home)
  if (autonomyOn() && workingTime() && upTop() && Date.now() >= nextHarvestAt) {
    nextHarvestAt = Date.now() + HARVEST_EVERY_MS;
    const { farmRipe, RIPE_ENOUGH } = await import("./farm");
    if (farmRipe() >= RIPE_ENOUGH) propose(harvestTask());
  }
}

/** A new connection: a fresh start. */
export function resetFoodWatch(): void {
  nextTryAt = 0;
  nextHarvestAt = 0;
  toldOwner = false;
}
