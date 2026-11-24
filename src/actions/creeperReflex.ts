// Path: src/actions/creeperReflex.ts
// Survival reflex: creepers are handled the moment they get close, whatever the
// bot is doing. With a weapon it closes in, hits and steps back (knockback
// resets the fuse); without one, or when the creeper is about to blow, it runs.
// At night it engages from farther away.

import type { Entity } from "prismarine-entity";
import type { Item } from "prismarine-item";
import { bot, onConnectionEnd } from "../core/body";
import { fighting, pathing } from "../core/plugins";
import { areReflexesMuted, registerReflexStopper, setReflexActive } from "../core/reflexes";

const CHECK_MS = 150;
const DAY_RADIUS = 9;
const NIGHT_RADIUS = 16;
const HIT_RANGE = 3.1;
const SAFE_DISTANCE = 9;
const HIT_COOLDOWN_MS = 650;

let active = false;
let busy = false;
let lastHitAt = 0;

/** True while the bot is dealing with a creeper (other code should wait). */
export function isCreeperReflexActive(): boolean {
  return active;
}


function isNight(): boolean {
  const t = bot.time?.timeOfDay ?? 0;
  return t >= 12500 && t <= 23500;
}

function bestWeapon(): Item | null {
  const tiers = ["wooden", "golden", "stone", "iron", "diamond", "netherite"];
  const score = (name: string): number =>
    (name.endsWith("_sword") ? 10 : 0) + Math.max(0, tiers.findIndex((t) => name.startsWith(t)));
  return (
    bot.inventory
      .items()
      .filter((i) => i.name.endsWith("_sword") || i.name.endsWith("_axe"))
      .sort((a, b) => score(b.name) - score(a.name))[0] ?? null
  );
}

/** Best effort: creeper "state" metadata is 1 while its fuse is burning. */
function isFusing(creeper: Entity): boolean {
  const meta = creeper.metadata as unknown[];
  return meta?.[16] === 1;
}

function setOnly(states: Partial<Record<"forward" | "back" | "sprint" | "jump", boolean>>): void {
  for (const control of ["forward", "back", "left", "right", "sprint", "jump"] as const) {
    bot.setControlState(control, Boolean(states[control as keyof typeof states]));
  }
}

async function faceAwayFrom(creeper: Entity): Promise<void> {
  const dx = bot.entity.position.x - creeper.position.x;
  const dz = bot.entity.position.z - creeper.position.z;
  await bot.look(Math.atan2(-dx, -dz), 0, true);
}

function finish(): void {
  if (!active) return;
  active = false;
  setOnly({});
  setReflexActive("creeper", false);
  pathing.resumeAfterReflex();
  console.log("Creeper reflex: clear.");
}

async function tick(): Promise<void> {
  if (busy || !bot.entity || !(bot.health > 0)) return;
  if (areReflexesMuted()) {
    finish(); // the owner said stop (e.g. penned-in creepers at a mob farm)
    return;
  }
  const radius = isNight() ? NIGHT_RADIUS : DAY_RADIUS;
  const creeper = bot.nearestEntity(
    (e) => e.name === "creeper" && e.position.distanceTo(bot.entity.position) <= (active ? SAFE_DISTANCE + 4 : radius)
  );
  if (!creeper) {
    finish();
    return;
  }

  busy = true;
  try {
    const distance = creeper.position.distanceTo(bot.entity.position);
    if (!active) {
      active = true;
      console.log(`Creeper reflex: creeper ${distance.toFixed(1)} blocks away${isNight() ? " (night)" : ""}.`);
      setReflexActive("creeper", true);
      pathing.takeOver(); // take over movement from whatever task is running
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

    if (bot.heldItem?.name !== weapon!.name) await bot.equip(weapon!, "hand");
    await bot.lookAt(creeper.position.offset(0, 1.2, 0), true);

    if (distance <= HIT_RANGE) {
      if (Date.now() - lastHitAt >= HIT_COOLDOWN_MS) {
        lastHitAt = Date.now();
        bot.attack(creeper);
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
  const timer = setInterval(() => void tick(), CHECK_MS);
  onConnectionEnd(bot, () => clearInterval(timer));
  bot.on("death", finish);
  registerReflexStopper("creeper", finish);
}
