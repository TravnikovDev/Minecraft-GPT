// Path: src/roles/guard.ts
// The guard (Phase 8): follows the owner at a distance and fights off the
// mobs that come for them. Never a player, a pet, a villager or a golem;
// never a neutral mob (an enderman, a zombified piglin: attacking one starts
// a war) nor a creeper (it would blow up next to the owner); only mobs it can
// see. Stances: follow (the owner), stay (at its post, back there after a
// fight), patrol (walks round its post). A shift runs only while the owner
// is in sight (follow) or at its post (stay, patrol); with the owner away a
// following guard lives its own life. Its walking goal is only set while no
// reflex holds the body (running from a creeper or from mobs at low health).

import { Vec3 } from "vec3";
import pf from "mineflayer-pathfinder";
import type { Entity } from "prismarine-entity";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { isCommandCancelled } from "../core/commandContext";
import { fighting, pathing } from "../core/plugins";
import { goTo } from "../core/primitives";
import { isAnyReflexActive, areReflexesMuted } from "../core/reflexes";
import { ok, type ActionResult } from "../core/result";
import { OWNER_USERNAME } from "../config/env";
import { isNeutralNow } from "../actions/combat";
import { canSeePoint, type SightWorld } from "../actions/sight";
import type { Role } from "./role";

export type Shift = { result: ActionResult; restMs: number; progress?: boolean };

// One shift of guarding (then the runner starts the next; owner commands cut in)
const SHIFT_MS = 60_000;
const LOOK_MS = 300;
// Mobs this close to the one guarded are a threat; a fight is left when the
// mob gets this far (it ran) or after this long, and that mob is then left
// alone for a while (a zombie in a cave under the owner can't be reached)
const THREAT_RANGE = 10;
const CHASE_LIMIT = 14;
const FIGHT_MS = 12_000;
const IGNORE_MS = 60_000;
const PATROL_STEP_MS = 8_000;
// Never a target, whatever the catalog says
const NEVER = new Set(["player", "wolf", "cat", "parrot", "horse", "donkey", "mule", "llama", "villager", "wandering_trader", "iron_golem", "snow_golem", "allay", "creeper"]);

const ignored = new Map<number, number>();

/** True for a mob the guard may fight: hostile by the game's list, not neutral now, never on the never-list. Pure. */
export function mayFight(name: string | undefined, isHostile: (n: string) => boolean, night = true): boolean {
  return Boolean(name) && !NEVER.has(name!) && !isNeutralNow(name!, night) && isHostile(name!);
}

const isNight = (): boolean => {
  const t = bot.time?.timeOfDay ?? 0;
  return t >= 13000 && t < 23000;
};

/** True when the bot can see the mob (through no ground or walls). */
function inSight(e: Entity): boolean {
  const eyes = bot.entity.position.offset(0, 1.62, 0);
  const d = e.position.distanceTo(bot.entity.position);
  return d <= 3 || canSeePoint(bot.world as unknown as SightWorld, eyes, e.position.offset(0, (e.height ?? 1.8) / 2, 0), d + 1);
}

/** The mob nearest `centre` (the owner, or its post) that threatens it, if any. */
export function threatNear(centre: Vec3, exclude: Entity | null = null): Entity | null {
  const me = bot.entity.position;
  const now = Date.now();
  const night = isNight();
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of Object.values(bot.entities)) {
    if (e === bot.entity || e === exclude || e.type === "player") continue;
    if ((ignored.get(e.id) ?? 0) > now) continue;
    if (!mayFight(e.name, (n) => catalog().isHostile(n), night)) continue;
    const d = e.position.distanceTo(centre);
    if (d > THREAT_RANGE || e.position.distanceTo(me) > 24 || d >= bestD || !inSight(e)) continue;
    best = e;
    bestD = d;
  }
  return best;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Fights one mob until it's gone, ran off, the owner said stop, or it took too long (then left alone a while). */
async function fight(target: Entity, centre: () => Vec3): Promise<void> {
  const { attackEntity } = await import("../actions/combat");
  await attackEntity(target, false);
  const until = Date.now() + FIGHT_MS;
  let gone = false;
  while (!isCommandCancelled() && !areReflexesMuted() && Date.now() < until) {
    const alive = bot.entities[target.id];
    if (!alive) {
      gone = true;
      break;
    }
    if (alive.position.distanceTo(centre()) > CHASE_LIMIT) break;
    await sleep(LOOK_MS);
  }
  fighting.stop();
  if (!gone) ignored.set(target.id, Date.now() + IGNORE_MS);
}

/** The owner's entity, when the bot can see them. */
const ownerEntity = (): Entity | null => bot.players[OWNER_USERNAME]?.entity ?? null;

/** True when a shift has something to do now (the runner proposes one only then). */
export function guardHasWork(role: Role): boolean {
  if (role.stance === "follow") return ownerEntity() !== null;
  return role.anchor !== null;
}

/** Keeps following the owner: set again when it isn't, or the owner's entity changed; never while a reflex holds the body. */
let followed: number | null = null;
async function keepFollowing(owner: Entity): Promise<void> {
  if (isAnyReflexActive()) return;
  const goal = pathing.currentGoal() as { entity?: Entity } | null;
  if (followed === owner.id && goal?.entity === owner) return;
  const { followPlayer } = await import("../actions/movement");
  if (await followPlayer(OWNER_USERNAME, 3)) followed = owner.id;
}

/** Back to its post (stay), or to a random spot around it (patrol). */
async function toPost(role: Role, patrol: boolean): Promise<void> {
  if (isAnyReflexActive() || !role.anchor) return;
  const a = role.anchor;
  const r = patrol ? Math.max(3, Math.min(role.radius, 12)) : 0;
  const x = a.x + Math.round((Math.random() * 2 - 1) * r);
  const z = a.z + Math.round((Math.random() * 2 - 1) * r);
  if (!patrol && bot.entity.position.distanceTo(new Vec3(a.x, a.y, a.z)) <= 3) return;
  await goTo(new pf.goals.GoalNear(x, a.y, z, 2));
}

/** One shift: guards the owner (follow) or its post (stay, patrol), fighting what threatens. */
export async function guardShift(role: Role): Promise<Shift> {
  const follow = role.stance === "follow";
  const end = Date.now() + SHIFT_MS;
  let fights = 0;
  let nextPatrol = 0;
  try {
    while (!isCommandCancelled() && !areReflexesMuted() && Date.now() < end) {
      const owner = ownerEntity();
      if (follow && !owner) break; // the owner left: its own life goes on
      const centre = (): Vec3 => (follow ? (ownerEntity() ?? owner!).position : new Vec3(role.anchor!.x, role.anchor!.y, role.anchor!.z));
      if (follow) await keepFollowing(owner!);
      else if (Date.now() >= nextPatrol) {
        nextPatrol = Date.now() + PATROL_STEP_MS;
        await toPost(role, role.stance === "patrol");
      }
      const threat = threatNear(centre(), owner);
      if (threat) {
        fights++;
        followed = null; // the fight took the walking goal: follow again after
        await fight(threat, centre);
        if (!follow) nextPatrol = 0; // straight back to its post
      }
      await sleep(LOOK_MS);
    }
  } finally {
    fighting.stop();
    if (!isAnyReflexActive()) pathing.stop();
    followed = null;
  }
  if (fights > 0) console.log(`Guard: fought ${fights} mobs off this shift.`);
  return { result: ok(), restMs: 0, progress: true };
}
