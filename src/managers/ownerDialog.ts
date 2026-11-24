// Path: src/managers/ownerDialog.ts
// Talking to the owner personally: whispers (only the owner sees them),
// where the owner is, and yes/no questions the bot can ask and wait on.

import type { Entity } from "prismarine-entity";
import { bot } from "..";
import { OWNER_USERNAME } from "../config/env";

const DUPLICATE_WINDOW_MS = 3000;
let lastMessage = "";
let lastMessageAt = 0;

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

// Where the owner was last seen or said they are, for "come here" when out of sight
const LAST_KNOWN_TTL_MS = 30 * 60 * 1000;
let lastKnown: { x: number; y: number; z: number; at: number } | null = null;

/** Records where the owner is (seen, or coordinates they typed). */
export function rememberOwnerPosition(x: number, y: number, z: number): void {
  lastKnown = { x, y, z, at: Date.now() };
}

/** The owner's last known position (within 30 minutes), or null. */
export function lastKnownOwnerPosition(): { x: number; y: number; z: number } | null {
  const seen = ownerEntity();
  if (seen) rememberOwnerPosition(seen.position.x, seen.position.y, seen.position.z);
  if (!lastKnown || Date.now() - lastKnown.at > LAST_KNOWN_TTL_MS) return null;
  return { x: lastKnown.x, y: lastKnown.y, z: lastKnown.z };
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
  const now = Date.now();
  if (message === lastMessage && now - lastMessageAt < DUPLICATE_WINDOW_MS) return;
  lastMessage = message;
  lastMessageAt = now;

  const name = ownerName();
  console.log(`[to owner] ${message}`);
  if (!name) return;
  try {
    bot.whisper(name, message);
  } catch (error) {
    console.error("Failed to whisper to owner:", error);
  }
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
  ttlMs = 2 * 60 * 1000
): void {
  pending = { question, onYes, ...(onNo ? { onNo } : {}), expiresAt: Date.now() + ttlMs };
  tellOwner(`${question} (yes/no)`);
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
