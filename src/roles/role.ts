// Path: src/roles/role.ts
// Companion roles (Phase 8): a standing order from the owner, set and
// changed by chat ("be my farmer at this field, put the wheat in the chest
// here"). A role is a job, where it works (an anchor and a radius), how it
// stands (follow, stay, patrol), what it works on (a crop, an ore, a
// blueprint) and where the results go (a storage chest). It is kept in
// world memory and runs in bucket B3: above its own life, below the owner's
// direct commands and its reflexes.

import { getMemory, updateMemory } from "../managers/persistenceManager";

export const JOBS = ["guard", "farmer", "miner", "hauler", "builder"] as const;
export type Job = (typeof JOBS)[number];
export type Stance = "follow" | "stay" | "patrol";
export type Spot = { x: number; y: number; z: number };

export type Role = {
  job: Job;
  anchor: (Spot & { dimension: string }) | null;
  radius: number;
  stance: Stance;
  target: string | null;
  storage: Spot | null;
  since: number;
};

/** The usual radius and stance of each job. */
export const JOB_DEFAULTS: Record<Job, { radius: number; stance: Stance }> = {
  guard: { radius: 16, stance: "follow" },
  farmer: { radius: 12, stance: "stay" },
  miner: { radius: 0, stance: "stay" },
  hauler: { radius: 10, stance: "stay" },
  builder: { radius: 8, stance: "stay" },
};

/** What each job does, for chat ("I'm your farmer: ..."). */
export const JOB_ABOUT: Record<Job, string> = {
  guard: "I follow you and fight off the mobs that come for you",
  farmer: "I harvest and replant the field and put the crops in the chest",
  miner: "I mine in my mine and bring the ore back",
  hauler: "I sort the chests so each kind of thing has its own chest",
  builder: "I build it block by block and tell you what I'm missing",
};

/** Its role now, or null when it has none. */
export function currentRole(): Role | null {
  return (getMemory().role as Role | undefined) ?? null;
}

/** Gives it a role (replacing any other). */
export async function setRole(role: Role): Promise<void> {
  await updateMemory({ role });
}

/** Off duty: no role any more. */
export async function clearRole(): Promise<void> {
  await updateMemory({ role: undefined });
}

/** A role from the owner's words, with each job's usual radius and stance. Pure. */
export function makeRole(job: Job, options: { anchor?: Role["anchor"]; radius?: number | null; stance?: Stance | null; target?: string | null; storage?: Spot | null; at: number }): Role {
  const d = JOB_DEFAULTS[job];
  return {
    job,
    anchor: options.anchor ?? null,
    radius: options.radius ?? d.radius,
    stance: options.stance ?? d.stance,
    target: options.target ?? null,
    storage: options.storage ?? null,
    since: options.at,
  };
}

/** The role in one line, for chat and the planner. Pure. */
export function describeRole(role: Role | null): string {
  if (!role) return "I have no job right now.";
  const where = role.anchor ? ` at ${role.anchor.x}, ${role.anchor.y}, ${role.anchor.z}` : "";
  const what = role.target ? ` (${role.target.replace(/_/g, " ")})` : "";
  const chest = role.storage ? `; results go in the chest at ${role.storage.x}, ${role.storage.y}, ${role.storage.z}` : "";
  return `I'm your ${role.job}${what}${where}: ${JOB_ABOUT[role.job]}${chest}.`;
}
