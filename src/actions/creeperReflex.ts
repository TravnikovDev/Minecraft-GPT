// Path: src/actions/creeperReflex.ts
// Survival reflex: creepers are handled the moment they get close, whatever the
// bot is doing. With a weapon it closes in, hits and steps back (knockback
// resets the fuse); without one, or when the creeper is about to blow, it runs.
// At night it engages from farther away.

import type { Entity } from "prismarine-entity";
import { bestMeleeWeapon } from "./combat";
import { catalog } from "../core/catalog";
import { canSeePoint, type SightWorld } from "./sight";
import { isSheltered } from "../core/sheltered";
import type { Item } from "prismarine-item";
import { bot, onConnectionEnd } from "../core/body";
import { equipItem, hitEntity, lookAt, lookToward, setControl } from "../core/primitives";
import { fighting, pathing, takeOverBody } from "../core/plugins";
import { areReflexesMuted, asReflex, registerReflexStopper, setReflexActive } from "../core/reflexes";

const CHECK_MS = 150;
const DAY_RADIUS = 9;
const NIGHT_RADIUS = 16;
const HIT_RANGE = 3.1;
const SAFE_DISTANCE = 9;
const HIT_COOLDOWN_MS = 650;
// Another mob hitting it while the creeper is still this far: that mob first
const CREEPER_FIRST_WITHIN = 5;
const BRAWL_RANGE = 4;
const GIVE_WAY_MS = 4_000;
// A creeper it was dealing with stays its target this long after it last saw
// it: in water the bot bobs and its line of sight flickers every tick, and
// each flicker handed the legs back and forth (game test: 700 on/off switches
// in two minutes; every walk home failed with "the goal was changed")
const KEEP_SEEN_MS = 2_000;

let active = false;
let busy = false;
let lastHitAt = 0;
let givingWayUntil = 0;
let trackedId: number | null = null;
let trackedSeenAt = 0;

/** True while the bot is dealing with a creeper (other code should wait). */
export function isCreeperReflexActive(): boolean {
  return active;
}


function isNight(): boolean {
  const t = bot.time?.timeOfDay ?? 0;
  return t >= 12500 && t <= 23500;
}

function bestWeapon(): Item | null {
  return bestMeleeWeapon(bot.inventory.items());
}

/** Best effort: creeper "state" metadata is 1 while its fuse is burning. */
function isFusing(creeper: Entity): boolean {
  const meta = creeper.metadata as unknown[];
  return meta?.[16] === 1;
}

function setOnly(states: Partial<Record<"forward" | "back" | "sprint" | "jump", boolean>>): void {
  for (const control of ["forward", "back", "left", "right", "sprint", "jump"] as const) {
    setControl(control, Boolean(states[control as keyof typeof states]));
  }
}

async function faceAwayFrom(creeper: Entity): Promise<void> {
  const dx = bot.entity.position.x - creeper.position.x;
  const dz = bot.entity.position.z - creeper.position.z;
  await lookToward(Math.atan2(-dx, -dz), 0);
}

/**
 * True when the creeper it was dealing with still counts though it's out of
 * sight right now: seen under `keepMs` ago and still within `maxDistance`. Pure.
 */
export function stillTracked(seenAt: number, now: number, distance: number, maxDistance: number, keepMs = KEEP_SEEN_MS): boolean {
  return now - seenAt < keepMs && distance <= maxDistance;
}

function finish(reason = "clear"): void {
  trackedId = null;
  if (!active) return;
  active = false;
  setOnly({});
  setReflexActive("creeper", false);
  pathing.resumeAfterReflex();
  console.log(`Creeper reflex: ${reason}.`);
}

/** Another hostile mob at arm's length (a zombie hitting it while it watched a creeper). */
function brawler(): Entity | null {
  return bot.nearestEntity(
    (e) => e.name !== "creeper" && !!e.name && catalog().isHostile(e.name) && e.position.distanceTo(bot.entity.position) <= BRAWL_RANGE
  );
}

async function tick(): Promise<void> {
  if (busy || !bot.entity || !(bot.health > 0)) return;
  if (areReflexesMuted()) {
    finish(); // the owner said stop (e.g. penned-in creepers at a mob farm)
    return;
  }
  const radius = isNight() ? NIGHT_RADIUS : DAY_RADIUS;
  // Only a creeper it can see (or one right by it): through ground it can't
  // reach the bot, and going for it digs the bot out of its shelter
  const eyes = bot.entity.position.offset(0, 1.62, 0);
  const range = active ? SAFE_DISTANCE + 4 : radius;
  const seen = bot.nearestEntity((e) => {
    if (e.name !== "creeper") return false;
    const d = e.position.distanceTo(bot.entity.position);
    if (d > range) return false;
    if (d <= CREEPER_FIRST_WITHIN) return true;
    if (isSheltered()) return false;
    return canSeePoint(bot.world as unknown as SightWorld, eyes, e.position.offset(0, 0.85, 0), d + 1);
  });
  if (seen) {
    trackedId = seen.id;
    trackedSeenAt = Date.now();
  }
  // Out of sight for a moment: the one it was dealing with still counts
  const kept = !seen && active && trackedId !== null ? bot.entities[trackedId] : undefined;
  const creeper =
    seen ?? (kept && kept.isValid !== false && stillTracked(trackedSeenAt, Date.now(), kept.position.distanceTo(bot.entity.position), range) ? kept : null);
  if (!creeper) {
    finish();
    return;
  }
  const distance = creeper.position.distanceTo(bot.entity.position);
  // A mob already hitting it comes first, unless the creeper is close or hissing:
  // the combat reflex fights it (first game test: a zombie killed the bot while
  // this reflex walked toward a creeper 9 blocks away and ignored it)
  const closeCall = distance <= CREEPER_FIRST_WITHIN || isFusing(creeper);
  if (!closeCall && (Date.now() < givingWayUntil || brawler())) {
    if (Date.now() >= givingWayUntil) givingWayUntil = Date.now() + GIVE_WAY_MS;
    finish("giving way: another mob is attacking");
    return;
  }

  busy = true;
  try {
    if (!active) {
      active = true;
      console.log(`Creeper reflex: creeper ${distance.toFixed(1)} blocks away${isNight() ? " (night)" : ""}.`);
      setReflexActive("creeper", true);
      takeOverBody(); // take over movement from whatever task is running
      fighting.stop();
    }

    const weapon = bestWeapon();
    const mustRun = !weapon || (isFusing(creeper) && distance < 4);
    if (mustRun) {
      // Run straight away until safe
      await faceAwayFrom(creeper);
      setOnly({ forward: true, sprint: true, jump: distance < 3 });
      if (distance > SAFE_DISTANCE) finish();
      return;
    }

    if (bot.heldItem?.name !== weapon!.name) await equipItem(weapon!.name, "hand");
    await lookAt(creeper.position.offset(0, 1.2, 0));

    if (distance <= HIT_RANGE) {
      if (Date.now() - lastHitAt >= HIT_COOLDOWN_MS) {
        lastHitAt = Date.now();
        hitEntity(creeper);
      }
      setOnly({ back: true }); // step back after the hit, out of blast range
    } else if (distance < HIT_RANGE + 1.5) {
      setOnly({}); // let it come into reach
    } else {
      setOnly({ forward: true }); // close in at walking speed (easy to stop)
    }
  } catch (error) {
    console.error("Creeper reflex error:", error);
  } finally {
    busy = false;
  }
}

/** Starts the reflex for the current bot instance. */
export function registerCreeperReflex(): void {
  // Fresh state for this connection
  active = false;
  busy = false;
  lastHitAt = 0;
  givingWayUntil = 0;
  trackedId = null;
  trackedSeenAt = 0;
  // Its moves run as the creeper reflex: they never wait for the task it paused
  const timer = setInterval(() => void asReflex("creeper", tick), CHECK_MS);
  onConnectionEnd(bot, () => clearInterval(timer));
  bot.on("death", () => asReflex("creeper", finish));
  registerReflexStopper("creeper", finish);
}
