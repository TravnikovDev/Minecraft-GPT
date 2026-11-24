// Path: src/actions/combatReflex.ts
// Survival reflex: when a hostile mob hits the bot or gets into melee range,
// the bot pauses its task, takes out its best weapon and fights until the mob
// is dead or gone, then the task carries on. Before this, self-defense started
// an attack but the running task kept setting new walking goals, cancelling
// the fight while zombies and spiders hit the bot.
// Creepers are left to the creeper reflex, and running out of air wins over
// fighting.

import type { Entity } from "prismarine-entity";
import { bot, onConnectionEnd } from "../core/body";
import { on } from "../core/events";
import { fighting, pathing } from "../core/plugins";
import { areReflexesMuted, registerReflexStopper, setReflexActive } from "../core/reflexes";
import { getAttackDamage } from "../utils/utility";
import { getPriorityTargets } from "./combat";
import { isCreeperReflexActive } from "./creeperReflex";
import { isDrowningReflexActive } from "./drowningReflex";

const CHECK_MS = 300;
const MELEE_RANGE = 3.5; // a mob this close is about to hit
const HIT_BACK_RANGE = 6; // after taking damage, fight what's this close
const NIGHT_RANGE = 8; // at night, deal with mobs before they reach the bot
const GIVE_UP_RANGE = 14; // stop chasing a mob that runs this far
const MAX_FIGHT_MS = 30_000; // a mob the bot can't reach (on a wall, behind a fence)

const IGNORE_MS = 60_000; // after giving up on a mob, leave it alone this long

let target: Entity | null = null;
// Mobs the bot gave up on (id -> until when), so it doesn't re-engage forever
const ignored = new Map<number, number>();
let startedAt = 0;
let unsubscribe: (() => void) | null = null;

/** True while the bot is fighting off a mob (other code should wait). */
export function isCombatReflexActive(): boolean {
  return target !== null;
}

function isNight(): boolean {
  const t = bot.time?.timeOfDay ?? 0;
  return t >= 13000 && t < 23000;
}

const distanceTo = (e: Entity): number => e.position.distanceTo(bot.entity.position);
const isAlive = (e: Entity): boolean => Boolean(bot.entities[e.id]) && (e.health === undefined || e.health > 0);

/** The mob to fight within range, or null. */
function pickTarget(range: number): Entity | null {
  const now = Date.now();
  return getPriorityTargets(range).find((e) => isAlive(e) && (ignored.get(e.id) ?? 0) < now) ?? null;
}

/** Takes out the best sword or axe (a pickaxe or shovel if that's all there is). */
async function equipWeapon(): Promise<void> {
  const items = bot.inventory.items();
  let weapons = items.filter((i) => i.name.endsWith("_sword") || i.name.endsWith("_axe"));
  if (weapons.length === 0) weapons = items.filter((i) => i.name.endsWith("_pickaxe") || i.name.endsWith("_shovel"));
  if (weapons.length === 0) return; // fists
  const best = weapons.sort((a, b) => getAttackDamage(b) - getAttackDamage(a))[0];
  if (bot.heldItem?.name !== best.name) await bot.equip(best, "hand");
}

function engage(mob: Entity): void {
  if (target?.id === mob.id) return;
  const first = target === null;
  target = mob;
  startedAt = Date.now(); // each mob gets its own time limit
  if (first) {
    setReflexActive("combat", true);
    pathing.takeOver(); // pause the task's walking; it resumes when we're done
    console.log(`Combat reflex: fighting ${mob.name} ${distanceTo(mob).toFixed(1)} blocks away.`);
  }
  void equipWeapon()
    .catch((error) => console.error("Combat reflex: equipping a weapon failed:", error))
    .then(() => {
      if (target?.id === mob.id) void fighting.attack(mob);
    });
}

function finish(reason: string): void {
  if (!target) return;
  target = null;
  fighting.stop();
  setReflexActive("combat", false);
  pathing.resumeAfterReflex();
  console.log(`Combat reflex: ${reason}.`);
}

function tick(): void {
  if (!bot.entity || !(bot.health > 0)) return;
  if (bot.vehicle) return; // no melee from a boat (and rowing owns movement)
  if (isCreeperReflexActive() || isDrowningReflexActive()) {
    finish("stepping aside for another reflex");
    return;
  }

  if (target) {
    const over = !isAlive(target) || distanceTo(target) > GIVE_UP_RANGE;
    if (Date.now() - startedAt > MAX_FIGHT_MS) {
      ignored.set(target.id, Date.now() + IGNORE_MS);
      finish(`gave up on ${target.name} (couldn't finish it)`);
      return;
    }
    if (!over) {
      // Re-assert every tick: if something else cleared pvp's target, attack
      // again instead of standing "in combat" doing nothing
      if (fighting.target()?.id !== target.id) void fighting.attack(target);
      return;
    }
    // Next mob, if another one is close
    const next = pickTarget(isNight() ? NIGHT_RANGE : HIT_BACK_RANGE);
    if (next) engage(next);
    else finish("all clear");
    return;
  }

  if (areReflexesMuted()) return; // the owner said stop: leave nearby mobs alone
  const mob = pickTarget(isNight() ? NIGHT_RANGE : MELEE_RANGE);
  if (mob) engage(mob);
}

/** Starts the reflex for the current bot instance. */
export function registerCombatReflex(): void {
  target = null; // fresh state for this connection
  ignored.clear();
  setReflexActive("combat", false);
  const timer = setInterval(tick, CHECK_MS);
  onConnectionEnd(bot, () => clearInterval(timer));
  bot.on("death", () => finish("died"));
  registerReflexStopper("combat", () => finish("stopped by the owner"));

  // Hit back when hurt, even by a mob that isn't in melee range yet (skeletons)
  unsubscribe?.();
  unsubscribe = on("bot:damaged", () => {
    if (target || bot.vehicle || isCreeperReflexActive() || isDrowningReflexActive()) return;
    const mob = pickTarget(HIT_BACK_RANGE);
    if (mob) engage(mob);
  });
}
