// Path: src/roles/guard.ts
// The guard (Phase 8): follows the owner at a distance and fights off the
// mobs that come for them. Never a player, a pet, a villager or a golem: only
// hostile mobs from the game's own list; never a creeper (it would blow up
// next to the owner: the creeper reflex keeps the bot away from them). With
// the owner offline it waits at its post (the anchor), or by its shelter.

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import type { Entity } from "prismarine-entity";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { isCommandCancelled } from "../core/commandContext";
import { fighting, pathing } from "../core/plugins";
import { goTo } from "../core/primitives";
import { ok, type ActionResult } from "../core/result";
import { OWNER_USERNAME } from "../config/env";
import type { Role } from "./role";

export type Shift = { result: ActionResult; restMs: number };

// One shift of guarding (then the runner starts the next; owner commands cut in)
const SHIFT_MS = 60_000;
const LOOK_MS = 300;
// Mobs this close to the owner are a threat; a fight is left when the mob
// gets this far from the owner (it ran) or after this long
const THREAT_RANGE = 10;
const CHASE_LIMIT = 14;
const FIGHT_MS = 12_000;
// Never a target, whatever the catalog says (players are never entities of
// a mob type; listed for the reader)
const NEVER = new Set(["player", "wolf", "cat", "parrot", "horse", "donkey", "mule", "llama", "villager", "wandering_trader", "iron_golem", "snow_golem", "allay", "creeper"]);

/** True for a mob the guard may fight: hostile by the game's list and never on the never-list. Pure. */
export function mayFight(name: string | undefined, isHostile: (n: string) => boolean): boolean {
  return Boolean(name) && !NEVER.has(name!) && isHostile(name!);
}

/** The mob nearest the owner that threatens them, if any. */
export function threatTo(owner: Entity): Entity | null {
  const me = bot.entity.position;
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of Object.values(bot.entities)) {
    if (e === bot.entity || e === owner || e.type === "player") continue;
    if (!mayFight(e.name, (n) => catalog().isHostile(n))) continue;
    const d = e.position.distanceTo(owner.position);
    if (d <= THREAT_RANGE && e.position.distanceTo(me) <= 24 && d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Fights one mob until it's gone, ran off from the owner, or the fight took too long. */
async function fight(target: Entity, owner: Entity): Promise<void> {
  const { attackEntity } = await import("../actions/combat");
  await attackEntity(target, false);
  const until = Date.now() + FIGHT_MS;
  while (!isCommandCancelled() && Date.now() < until) {
    const alive = bot.entities[target.id];
    if (!alive || alive.position.distanceTo(owner.position) > CHASE_LIMIT) break;
    await sleep(LOOK_MS);
  }
  fighting.stop();
}

/** Waits at its post (the anchor, else its shelter) while the owner is away. */
async function standGuard(role: Role): Promise<Shift> {
  const post = role.anchor ?? (await import("../skills/capabilities")).shelter();
  if (post && bot.entity.position.distanceTo(new Vec3(post.x, post.y, post.z)) > 4) {
    await goTo(new pf.goals.GoalNear(post.x, post.y, post.z, 2));
  }
  return { result: ok(), restMs: 20_000 };
}

/** One shift: follows the owner, fighting what threatens them. */
export async function guardShift(role: Role): Promise<Shift> {
  const owner = bot.players[OWNER_USERNAME]?.entity;
  if (!owner) return standGuard(role);
  const { followPlayer } = await import("../actions/movement");
  const distance = role.stance === "stay" ? 0 : 3;
  const end = Date.now() + SHIFT_MS;
  let fights = 0;
  try {
    if (distance > 0) await followPlayer(OWNER_USERNAME, distance);
    while (!isCommandCancelled() && Date.now() < end) {
      const here = bot.players[OWNER_USERNAME]?.entity;
      if (!here) break; // the owner left
      const threat = threatTo(here);
      if (threat) {
        fights++;
        await fight(threat, here);
        if (distance > 0 && !isCommandCancelled()) await followPlayer(OWNER_USERNAME, distance);
      }
      await sleep(LOOK_MS);
    }
  } finally {
    fighting.stop();
    pathing.stop();
  }
  if (fights > 0) console.log(`Guard: fought ${fights} mobs off this shift.`);
  return { result: ok(), restMs: 0 };
}
