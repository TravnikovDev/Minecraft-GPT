// Path: src/managers/ownerDialog.ts
// Talking to the owner personally: whispers (only the owner sees them),
// where the owner is, and yes/no questions the bot can ask and wait on.

import type { Entity } from "prismarine-entity";
import { bot } from "../core/body";
import { OWNER_USERNAME } from "../config/env";
import { loadOwnerPosition, saveOwnerPosition } from "../core/session";
import { say } from "../core/narrator";
import { Bucket, currentTask } from "../core/arbiter";


/** The owner's name as the server spells it, if they are online. */
function ownerName(): string | null {
  const wanted = OWNER_USERNAME.toLowerCase();
  const match = Object.keys(bot.players).find((name) => name.toLowerCase() === wanted);
  return match ?? null;
}

/** The owner's entity, or null when they are offline or out of tracking range. */
export function ownerEntity(): Entity | null {
  const name = ownerName();
  return name ? bot.players[name]?.entity ?? null : null;
}

// Where the owner was last seen or said they are, for "come here" when out of
// sight. Saved in the Session, so it survives a bot restart.
const LAST_KNOWN_TTL_MS = 30 * 60 * 1000;

/** Records where the owner is: `typed` for coordinates they sent, else seen. */
export function rememberOwnerPosition(x: number, y: number, z: number, typed = false): void {
  void saveOwnerPosition({ x, y, z, at: Date.now() }, typed);
}

/** True when the bot is riding in the same boat (or vehicle) as the owner. */
export function ridingWithOwner(): boolean {
  const vehicle = bot.vehicle;
  if (!vehicle) return false;
  const name = ownerName();
  return vehicle.passengers.some((p) => p.username === name) || ownerEntity()?.vehicle === vehicle;
}

/** While riding, the bot is wherever its vehicle is (mineflayer doesn't move it). */
export function syncRidingPosition(): void {
  const vehicle = bot.vehicle;
  if (vehicle && bot.entity) bot.entity.position.set(vehicle.position.x, vehicle.position.y, vehicle.position.z);
}

/** Saves where the owner is while the bot can see them (saving is throttled). */
export function trackOwnerPosition(): void {
  const seen = ownerEntity();
  if (seen) rememberOwnerPosition(seen.position.x, seen.position.y, seen.position.z);
}

/** The owner's last known position (within 30 minutes), or null. */
export function lastKnownOwnerPosition(): { x: number; y: number; z: number } | null {
  const seen = ownerEntity();
  if (seen) {
    rememberOwnerPosition(seen.position.x, seen.position.y, seen.position.z);
    return { x: seen.position.x, y: seen.position.y, z: seen.position.z };
  }
  const saved = loadOwnerPosition();
  if (!saved || Date.now() - saved.at > LAST_KNOWN_TTL_MS) return null;
  return { x: saved.x, y: saved.y, z: saved.z };
}

/** Distance to the owner in blocks, or null if the bot can't see them. */
export function ownerDistance(): number | null {
  const owner = ownerEntity();
  if (!owner || !bot.entity) return null;
  return owner.position.distanceTo(bot.entity.position);
}

/** Compass direction from the owner to the bot, e.g. "north-east". */
export function directionFromOwner(): string | null {
  const owner = ownerEntity();
  if (!owner || !bot.entity) return null;
  const dx = bot.entity.position.x - owner.position.x;
  const dz = bot.entity.position.z - owner.position.z;
  // Minecraft: -z is north, +x is east
  const ns = Math.abs(dz) > Math.abs(dx) * 0.4 ? (dz < 0 ? "north" : "south") : "";
  const ew = Math.abs(dx) > Math.abs(dz) * 0.4 ? (dx > 0 ? "east" : "west") : "";
  return [ns, ew].filter(Boolean).join("-") || "here";
}

/**
 * Sends a personal message to the owner (a whisper), so status updates don't
 * clutter everyone's chat. Falls back to the log when the owner is offline.
 */
export function tellOwner(message: string): void {
  say(message, { kind: "report", to: "owner" });
}

// --- Yes/no questions ---------------------------------------------------

interface PendingQuestion {
  question: string;
  onYes: () => Promise<void>;
  onNo?: () => Promise<void>;
  expiresAt: number;
}

let pending: PendingQuestion | null = null;

/** Asks the owner a yes/no question; the answer arrives through answerPending(). */
export function askOwner(
  question: string,
  onYes: () => Promise<void>,
  onNo?: () => Promise<void>,
  ttlMs = 2 * 60 * 1000,
  onMyOwn: "yes" | "no" = "no"
): void {
  // Its own errands (living its own life, a role, upkeep): nobody answers
  // these, so it decides and carries on (the owner's rule)
  const running = currentTask();
  if (running && running.bucket >= Bucket.Role) {
    console.log(`Deciding on my own (${running.name}): "${question}" -> ${onMyOwn}.`);
    void (onMyOwn === "yes" ? onYes() : (onNo?.() ?? Promise.resolve())).catch((error) => console.error("My own decision failed:", error));
    return;
  }
  pending = { question, onYes, ...(onNo ? { onNo } : {}), expiresAt: Date.now() + ttlMs };
  // A question to the owner goes first; not kept for later (it expires)
  say(`${question} (yes/no)`, { kind: "reply", to: "owner", noHold: true });
}

/** True while a question is waiting for the owner's answer. */
export function hasPendingQuestion(): boolean {
  if (pending && Date.now() > pending.expiresAt) pending = null;
  return pending !== null;
}

/** Applies the owner's yes/no answer. Returns false if nothing was pending. */
export async function answerPending(yes: boolean): Promise<boolean> {
  if (!hasPendingQuestion() || !pending) return false;
  const question = pending;
  pending = null;
  if (yes) {
    await question.onYes();
  } else {
    if (question.onNo) await question.onNo();
    else tellOwner("Okay, I won't.");
  }
  return true;
}
