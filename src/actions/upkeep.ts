// Path: src/actions/upkeep.ts
// Looking after itself while it works (upkeep, Phase 4): eating when hungry
// and putting on armor it carries. These borrow the bot's hands politely
// (core/leases): they slot in between the running task's actions, the way a
// player eats a steak between two blocks, instead of grabbing the hands
// whenever a plugin likes (mineflayer-auto-eat and armor-manager used to).
// Starving or badly hurt, eating doesn't wait for a gap.

import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { borrow, release, runAs, takeUrgently, type Holder } from "../core/leases";
import { consumeItem } from "../core/primitives";
import { describeFailure } from "../core/result";

const HUNGRY_AT = 14; // food points (of 20), like auto-eat's default
const STARVING_AT = 6;
const HURT_AT = 10; // health: eat to heal, even if not very hungry
// Only when nothing else is left
const LAST_RESORT = new Set(["rotten_flesh", "poisonous_potato", "spider_eye", "pufferfish", "suspicious_stew"]);

let eating = false;

type Food = { name: string; foodPoints: number; saturation: number };

/** The food to eat now: the most filling (or, hurt, the most saturating); junk only when starving. */
export function pickFood(items: { name: string }[], foods: Record<string, { foodPoints?: number; saturation?: number }>, starving: boolean, hurt: boolean): string | null {
  const options: Food[] = [];
  for (const { name } of items) {
    const food = foods[name];
    if (!food || options.some((o) => o.name === name)) continue;
    if (LAST_RESORT.has(name) && !starving) continue;
    options.push({ name, foodPoints: food.foodPoints ?? 0, saturation: food.saturation ?? 0 });
  }
  options.sort((a, b) => (hurt ? b.saturation - a.saturation : 0) || b.foodPoints - a.foodPoints || b.saturation - a.saturation);
  return options[0]?.name ?? null;
}

/** Called every couple of seconds: eats when hungry (or hurt), between the task's actions. */
export async function eatWhenHungry(): Promise<void> {
  if (eating || !bot.entity || !(bot.health > 0) || bot.food >= 20) return;
  const starving = bot.food <= STARVING_AT;
  const hurt = bot.health <= HURT_AT;
  if (bot.food > HUNGRY_AT && !hurt) return;
  const food = pickFood(bot.inventory.items(), (bot.registry.foodsByName ?? {}) as never, starving, hurt);
  if (!food || !catalog().isFood(food)) return;

  eating = true;
  const holder: Holder = { name: "eating", bucket: starving || hurt ? 1 : 4 };
  const job = async (): Promise<void> => {
    const result = await consumeItem(food);
    if (result.ok) console.log(`Ate ${food.replace(/_/g, " ")} (food ${bot.food}/20, health ${Math.round(bot.health)}/20).`);
    else console.log(`Couldn't eat ${food}: ${describeFailure(result)}`);
  };
  try {
    const done = await borrow(holder, ["hands"], async () => {
      await job();
      return true;
    }, starving || hurt ? 3_000 : 10_000);
    if (done === null && (starving || hurt)) {
      // No gap came: starving or badly hurt, eat now
      takeUrgently(holder, ["hands"]);
      try {
        await runAs(holder, job);
      } finally {
        release(holder, ["hands"]);
      }
    }
  } finally {
    eating = false;
  }
}
