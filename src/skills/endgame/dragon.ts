// Path: src/skills/endgame/dragon.ts
// The dragon fight (Phase 9). Onto the main island (bridging from the spawn
// platform if it must), the end crystals shot down when it has a bow and
// arrows (they heal the dragon), then by the exit portal in the middle:
// when the dragon perches there it's hit through its head (the dragon is
// many parts; its head is its id + 1). Never off safe ground near the
// centre (the void kills), away from dragon breath, back off to eat when
// hurt. Done when the dragon is gone for good.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import type { Entity } from "prismarine-entity";
import { bot } from "../../core/body";
import { isCommandCancelled } from "../../core/commandContext";
import { equipItem, goTo, hitEntityId, lookAt, stopUsingItem, useHeldItemToward } from "../../core/primitives";
import { fail, ok, type ActionResult } from "../../core/result";
import { report } from "../../core/narrator";
import { safeOnIsland } from "./geometry";
import { count, dimensionNow, endgame, noteEndgame } from "./state";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const FIGHT_MS = 14 * 60_000; // inside a milestone's 15 minutes; the next try goes on
const HIT_COOLDOWN_MS = 650; // a sword's swing comes back in about this
const HIT_RANGE = 5;
const LOW_HEALTH = 8;

const dragon = (): Entity | null => bot.nearestEntity((e) => e.name === "ender_dragon");

/** Ground under a spot (for the void check). */
const below = (x: number, z: number, y: number): string | null => bot.blockAt(new Vec3(x, y - 1, z))?.name ?? null;

/** Walks to a spot only if it's safe ground on the island. */
async function safeGoTo(x: number, y: number, z: number): Promise<boolean> {
  if (!safeOnIsland({ x, z }, below(x, z, y))) return false;
  return (await goTo(new pf.goals.GoalNear(x, y, z, 1))).ok;
}

/** A safe spot near the middle (by the exit portal), a few blocks out. */
function spotNearMiddle(radius = 5): Vec3 | null {
  for (let tries = 0; tries < 24; tries++) {
    const a = Math.random() * Math.PI * 2;
    const x = Math.round(Math.cos(a) * radius);
    const z = Math.round(Math.sin(a) * radius);
    for (let y = 75; y > 55; y--) {
      const ground = bot.blockAt(new Vec3(x, y - 1, z));
      const feet = bot.blockAt(new Vec3(x, y, z));
      if (ground && ground.boundingBox === "block" && feet?.boundingBox === "empty" && safeOnIsland({ x, z }, ground.name)) return new Vec3(x, y, z);
    }
  }
  return null;
}

/** Shoots at an end crystal with a fully drawn bow, aiming above it for the arrow's drop. */
async function shootCrystal(crystal: Entity): Promise<void> {
  if (!(await equipItem("bow")).ok) return;
  const d = crystal.position.distanceTo(bot.entity.position);
  // A full-power arrow falls about d^2/360 blocks over d blocks; the bow is
  // drawn once the head has turned there (useHeldItemToward)
  await useHeldItemToward(crystal.position.offset(0, 0.5 + (d * d) / 360, 0));
  await sleep(1_100);
  stopUsingItem();
  await sleep(400);
}

/** The crystals on the pillars, shot down while it has arrows. */
async function shootCrystals(): Promise<void> {
  if (count("bow") === 0 || count("arrow") === 0) return;
  for (let shots = 0; shots < 64 && count("arrow") > 0 && !isCommandCancelled(); shots++) {
    const crystal = bot.nearestEntity((e) => e.name === "end_crystal" && e.position.distanceTo(bot.entity.position) < 64);
    if (!crystal) return;
    await shootCrystal(crystal);
  }
}

/**
 * True when the exit portal in the middle is open: it opens when the dragon
 * dies (out of sight for a while is not dead: it flies far between passes).
 */
function exitPortalOpen(): boolean {
  const id = bot.registry.blocksByName["end_portal"]?.id;
  if (id === undefined) return false;
  const p = bot.findBlock({ matching: id, maxDistance: 32, point: new Vec3(0, 62, 0) });
  return p !== null && Math.hypot(p.position.x, p.position.z) < 6;
}

/** The fight: by the exit portal, hitting the dragon's head when it's close. */
export async function fightDragon(): Promise<ActionResult> {
  if (endgame().dragonDefeated) return ok();
  if (dimensionNow() !== "the_end") return fail("refused", "I'm not in the End");
  // Onto the island (the pathfinder bridges from the spawn platform with the blocks it carries)
  const middle = await goTo(new pf.goals.GoalNearXZ(0, 0, 8));
  if (!middle.ok) return fail(middle.reason, "I couldn't get onto the main island");
  await shootCrystals();
  const { bestMeleeWeapon } = await import("../../actions/combat");
  const { eatWhenHungry } = await import("../../actions/upkeep");
  const weapon = bestMeleeWeapon(bot.inventory.items(), true);
  let lastHit = 0;
  let lastSeen = Date.now();
  // Victory only after it saw the dragon in this fight (an End whose dragon
  // was killed before has an open exit portal and no dragon from the start)
  let sawDragon = false;
  const { holdPosition } = await import("../../managers/stuckWatch");
  const until = Date.now() + FIGHT_MS;
  const post = spotNearMiddle();
  if (post) await safeGoTo(post.x, post.y, post.z);
  while (Date.now() < until && !isCommandCancelled()) {
    holdPosition(5_000); // waiting for the dragon to land is standing still on purpose
    const d = dragon();
    if (d) {
      lastSeen = Date.now();
      sawDragon = true;
    } else if (Date.now() - lastSeen > 15_000 && (sawDragon || !endgame().endVisited) && exitPortalOpen()) {
      await noteEndgame({ dragonDefeated: Date.now() });
      report("The dragon is dead! I freed the End!");
      return ok();
    }
    // Dragon breath (a lingering cloud, radius 5 growing to about 7) near: move to another spot
    const breath = bot.nearestEntity((e) => e.name === "area_effect_cloud" && e.position.distanceTo(bot.entity.position) < 7.5);
    if (breath) {
      const away = spotNearMiddle(7);
      if (away) await safeGoTo(away.x, away.y, away.z);
      continue;
    }
    if (bot.health < LOW_HEALTH) {
      await eatWhenHungry();
      await sleep(1_000);
      continue;
    }
    if (d && d.position.distanceTo(bot.entity.position) < HIT_RANGE + 4 && Date.now() - lastHit > HIT_COOLDOWN_MS) {
      if (weapon && bot.heldItem?.name !== weapon.name) await equipItem(weapon.name);
      // Its head (the dragon is many parts; the head is its id + 1). One hit
      // per swing: a second right after lands at a fifth of the strength
      await lookAt(d.position.offset(0, 1, 0));
      hitEntityId(d.id + 1);
      lastHit = Date.now();
    }
    await sleep(150);
  }
  return fail("refused", "the dragon fight took too long; I'll try again");
}

/**
 * Home from the End once the dragon is dead: into the exit portal in the
 * middle; the credits that follow are skipped (core/primitives
 * registerCreditsSkip) and it comes out at its spawn point.
 */
export async function leaveEnd(): Promise<ActionResult> {
  if (dimensionNow() !== "the_end") {
    await noteEndgame({ cameHome: endgame().cameHome ?? Date.now() });
    return ok();
  }
  if (!endgame().dragonDefeated) return fail("refused", "the way out opens when the dragon is dead");
  const id = bot.registry.blocksByName["end_portal"]?.id;
  const portal = id === undefined ? null : bot.findBlock({ matching: id, maxDistance: 48, point: new Vec3(0, 62, 0) });
  if (!portal) return fail("not_found", "I can't find the exit portal");
  await goTo(new pf.goals.GoalNear(portal.position.x, portal.position.y, portal.position.z, 2));
  // The last step by hand: walk into it
  const { setControl } = await import("../../core/primitives");
  await lookAt(portal.position.offset(0.5, 0, 0.5));
  setControl("forward", true);
  await sleep(1_500);
  setControl("forward", false);
  const { waitForDimension } = await import("./state");
  if (!(await waitForDimension("overworld", 30_000))) return fail("refused", "the exit portal didn't take me home");
  await noteEndgame({ cameHome: Date.now() });
  report("I'm home from the End!");
  return ok();
}
