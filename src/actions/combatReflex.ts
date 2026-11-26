// Path: src/actions/combatReflex.ts
// Survival reflex: when a hostile mob hits the bot or gets into melee range,
// the bot pauses its task, takes out its best weapon and fights until the mob
// is dead or gone, then the task carries on. Before this, self-defense started
// an attack but the running task kept setting new walking goals, cancelling
// the fight while zombies and spiders hit the bot.
// Creepers are left to the creeper reflex, and running out of air wins over
// fighting. Losing a fight (4 hearts or less) it backs off like a player:
// stops swinging and runs from the mobs until they're far or it has healed.

import type { Entity } from "prismarine-entity";
import pf from "mineflayer-pathfinder";
import { bot, onConnectionEnd } from "../core/body";
import { report } from "../core/narrator";
import { equipItem, hitEntity, lookAt } from "../core/primitives";
import { on } from "../core/events";
import { fighting, pathing, takeOverBody } from "../core/plugins";
import { areReflexesMuted, asReflex, registerReflexStopper, setReflexActive } from "../core/reflexes";
import { bestMeleeWeapon, getPriorityTargets } from "./combat";
import { canSeePoint, type SightWorld } from "./sight";
import { isSheltered } from "../core/sheltered";
import { isCreeperReflexActive } from "./creeperReflex";
import { isDrowningReflexActive } from "./drowningReflex";
import { isLavaReflexActive } from "./lavaReflex";
import { mobsOut } from "../core/daylight";

const CHECK_MS = 300;
const MELEE_RANGE = 3.5; // a mob this close is about to hit
const HIT_BACK_RANGE = 6; // after taking damage, fight what's this close
const NIGHT_RANGE = 8; // at night, deal with mobs before they reach the bot
const GIVE_UP_RANGE = 14; // stop chasing a mob that runs this far
const MAX_FIGHT_MS = 30_000; // a mob the bot can't reach (on a wall, behind a fence)

const IGNORE_MS = 60_000; // after giving up on a mob, leave it alone this long
const RETREAT_HEALTH = 8; // 4 hearts: losing, back off
const SAFE_HEALTH = 14; // healed enough to fight again
const FLEE_DISTANCE = 16; // how far to get from the mobs
const CORNERED_RANGE = 1.5; // a mob this close while running: hit it
const MAX_FLEE_MS = 25_000;
const RETREAT_NOTICE_MS = 60_000;
// Archers shoot from further than it hits back: one hitting it from up to
// here is fought (when it can) or run from. Game test: a skeleton 6-7 blocks
// off shot it for a minute while it stood still eating, and killed it
export const ARCHERS = new Set(["skeleton", "stray", "pillager", "witch", "piglin"]);
const ARCHER_RANGE = 16;
// An archer this close is charged even when hurt: running from it down a
// tunnel only gets it shot in the back (game test: at 8 health it backed off
// from a skeleton 4 blocks away, barely moved, took four arrows and died)
const ARCHER_CHARGE = 8;

/** True for an archer close enough to charge rather than run from (not one it gave up on reaching). */
function chargeArcher(e: Entity | null): boolean {
  return !!e && ARCHERS.has(e.name ?? "") && distanceTo(e) <= ARCHER_CHARGE && (ignored.get(e.id) ?? 0) <= Date.now();
}

let fleeing: Entity | null = null; // the mob it's running from
let fleeStartedAt = 0;
let lastRetreatNotice = 0;

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
  return mobsOut();
}

const distanceTo = (e: Entity): number => e.position.distanceTo(bot.entity.position);
const isAlive = (e: Entity): boolean => Boolean(bot.entities[e.id]) && (e.health === undefined || e.health > 0);

// Mobs that fly: chasing one builds dirt pillars after it and keeps the bot
// out in the open (a phantom kept it from its shelter all night, first game
// test). A player swings when one swoops in and goes on; so does the bot.
export const FLYING = new Set(["phantom", "vex", "ghast", "blaze", "bee"]);
const SWAT_RANGE = 3.2;
const SWAT_COOLDOWN_MS = 650;
let lastSwatAt = 0;

/**
 * A mob it could fight from here: within reach, or in plain sight. Through
 * ground or walls it's no reason to go anywhere (it dug out of its shelter to
 * fight a phantom 5 blocks of earth away). Shut in its shelter: only what is
 * in the room with it.
 */
function canFight(e: Entity): boolean {
  const d = distanceTo(e);
  if (d <= MELEE_RANGE) return true;
  if (isSheltered()) return false;
  const eyes = bot.entity.position.offset(0, 1.62, 0);
  return canSeePoint(bot.world as unknown as SightWorld, eyes, e.position.offset(0, (e.height ?? 1.8) / 2, 0), d + 1);
}

/** The mob to fight within range, or null (never a flying one: those get swatted). */
function pickTarget(range: number): Entity | null {
  const now = Date.now();
  return getPriorityTargets(range).find((e) => isAlive(e) && !FLYING.has(e.name ?? "") && canFight(e) && (ignored.get(e.id) ?? 0) < now) ?? null;
}

/** A swing at a flying mob within reach, without chasing it or stopping the task's walk. */
function swatFlyer(): void {
  if (Date.now() - lastSwatAt < SWAT_COOLDOWN_MS) return;
  const flyer = bot.nearestEntity((e) => FLYING.has(e.name ?? "") && isAlive(e) && distanceTo(e) <= SWAT_RANGE);
  if (!flyer) return;
  lastSwatAt = Date.now();
  // Face it and swing (the swing counts even if turning was cut short)
  void lookAt(flyer.position.offset(0, (flyer.height ?? 0.5) / 2, 0))
    .catch(() => {})
    .finally(() => {
      if (isAlive(flyer) && distanceTo(flyer) <= SWAT_RANGE) hitEntity(flyer);
    });
}

/** Takes out the best sword or axe (a pickaxe or shovel if that's all there is). */
async function equipWeapon(): Promise<void> {
  const best = bestMeleeWeapon(bot.inventory.items(), true);
  if (!best) return; // fists
  if (bot.heldItem?.name !== best.name) await equipItem(best.name, "hand");
}

function engage(mob: Entity): void {
  if (target?.id === mob.id) return;
  const first = target === null;
  target = mob;
  startedAt = Date.now(); // each mob gets its own time limit
  if (first) {
    setReflexActive("combat", true);
    takeOverBody(); // pause the task's walking; it resumes when we're done
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

/** Losing: stops fighting and runs from `threat` (the task stays paused). */
function retreat(threat: Entity): void {
  if (target) {
    target = null;
    fighting.stop();
  } else if (!fleeing) {
    setReflexActive("combat", true);
    takeOverBody();
  }
  if (fleeing?.id !== threat.id) {
    pathing.setReflexGoal(new pf.goals.GoalInvert(new pf.goals.GoalFollow(threat, FLEE_DISTANCE)), true);
  }
  if (!fleeing) {
    fleeStartedAt = Date.now();
    console.log(`Combat reflex: health ${Math.round(bot.health)}, backing off from ${threat.name}.`);
    if (Date.now() - lastRetreatNotice > RETREAT_NOTICE_MS) {
      lastRetreatNotice = Date.now();
      report("I\'m badly hurt, backing off!");
    }
  }
  fleeing = threat;
}

function stopRetreat(reason: string): void {
  if (!fleeing) return;
  fleeing = null;
  pathing.setReflexGoal(null);
  setReflexActive("combat", false);
  pathing.resumeAfterReflex();
  console.log(`Combat reflex: ${reason}.`);
}

/** An archer within ARCHER_RANGE that can see it (so it's the one shooting), ignored ones too. */
function nearestArcher(): Entity | null {
  return getPriorityTargets(ARCHER_RANGE).find((e) => isAlive(e) && ARCHERS.has(e.name ?? "") && canFight(e)) ?? null;
}

/** The nearest hostile mob within `range` (ignored ones too: they still hurt). */
function nearestThreat(range: number): Entity | null {
  // Running from a flyer is no use: it follows; going on (inside) is
  // Shut in, there's nowhere better to be: no running out into the night
  return getPriorityTargets(range).find((e) => isAlive(e) && !FLYING.has(e.name ?? "") && canFight(e)) ?? null;
}

function tick(): void {
  if (!bot.entity || !(bot.health > 0)) return;
  if (bot.vehicle) return; // no melee from a boat (and rowing owns movement)
  if (isCreeperReflexActive() || isDrowningReflexActive() || isLavaReflexActive()) {
    finish("stepping aside for another reflex");
    stopRetreat("stepping aside for another reflex");
    return;
  }

  // Running from a fight it was losing
  if (fleeing) {
    const threat = nearestThreat(FLEE_DISTANCE);
    if (!threat || bot.health >= SAFE_HEALTH) return stopRetreat(threat ? "healed, fighting again if needed" : "got away");
    // An archer close by: at it, not away from it
    const archer = nearestArcher();
    if (chargeArcher(archer)) {
      stopRetreat(`charging the ${archer!.name}`);
      engage(archer!);
      return;
    }
    if (Date.now() - fleeStartedAt > MAX_FLEE_MS) return stopRetreat("can't get away, standing my ground");
    if (distanceTo(threat) <= CORNERED_RANGE) {
      stopRetreat(`cornered by ${threat.name}`);
      engage(threat);
      return;
    }
    retreat(threat); // the nearest one may have changed
    return;
  }
  if (bot.health <= RETREAT_HEALTH) {
    const threat = nearestThreat(HIT_BACK_RANGE) ?? nearestArcher();
    if (threat && distanceTo(threat) > CORNERED_RANGE) {
      // Hurt, but an archer close by is charged: its arrows hit a back too
      // (and the fight below goes on); anything else, it backs off from
      if (!chargeArcher(threat)) {
        retreat(threat);
        return;
      }
      if (target?.id !== threat.id) engage(threat);
    }
  }

  if (target && FLYING.has(target.name ?? "")) {
    finish(`not chasing the ${target.name}`);
    return;
  }
  if (target) {
    // Gone behind a wall or ground (or it's shut in and the mob is outside): let it be
    const over = !isAlive(target) || distanceTo(target) > GIVE_UP_RANGE || !canFight(target);
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
  else swatFlyer();
}

/** Starts the reflex for the current bot instance. */
export function registerCombatReflex(): void {
  target = null; // fresh state for this connection
  ignored.clear();
  setReflexActive("combat", false);
  // Its moves run as the combat reflex: they never wait for the task it paused
  const timer = setInterval(() => asReflex("combat", tick), CHECK_MS);
  onConnectionEnd(bot, () => clearInterval(timer));
  fleeing = null;
  bot.on("death", () =>
    asReflex("combat", () => {
      finish("died");
      stopRetreat("died");
    })
  );
  registerReflexStopper("combat", () => {
    finish("stopped by the owner");
    stopRetreat("stopped by the owner");
  });

  // Hit back when hurt, even by a mob that isn't in melee range yet (skeletons)
  unsubscribe?.();
  unsubscribe = on("bot:damaged", () =>
    asReflex("combat", () => {
      if (target || fleeing || bot.vehicle || isCreeperReflexActive() || isDrowningReflexActive() || isLavaReflexActive()) return;
      const near = bot.health > RETREAT_HEALTH ? pickTarget(HIT_BACK_RANGE) : null;
      if (near) return engage(near);
      // Shot from further off: at the archer if it can, out of its way if it's
      // hurt or gave up on reaching it (it stood and took arrows till it died)
      const archer = nearestArcher();
      if (!archer) return;
      const unreachable = (ignored.get(archer.id) ?? 0) > Date.now();
      // Healthy, or hurt but it's close: at it; hurt and it's far, or out of reach: away
      if (!unreachable && (bot.health > RETREAT_HEALTH || chargeArcher(archer))) engage(archer);
      else retreat(archer);
    })
  );
}
