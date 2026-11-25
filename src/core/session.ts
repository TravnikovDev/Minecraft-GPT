// Path: src/core/session.ts
// The Session: state that lives for the whole process and survives both
// reconnects and bot restarts (saved in db.json under "memory"):
// - the last death (where/when, for item recovery),
// - the owner's last known position (for "come here" when out of sight),
// - the bot's own bed (its spawn point; it goes back to that one to sleep),
// - the chests it knows and what was in them when it last looked,
// - the recent conversation with the owner (sent with each AI request).

import { getMemory, updateMemory } from "../managers/persistenceManager";
import type { MemoryType } from "../schemas/types";

// --- Last death ------------------------------------------------------------

export type SavedDeath = NonNullable<MemoryType["lastDeath"]>;

export function loadDeath(): SavedDeath | null {
  return getMemory().lastDeath ?? null;
}

export async function saveDeath(death: SavedDeath | null): Promise<void> {
  await updateMemory({ lastDeath: death ?? undefined });
}

export type DeathEntry = NonNullable<MemoryType["deaths"]>[number];
const DEATHS_KEPT = 3;

/** The last few deaths, newest last (for "where did you die?"; never cleared by recovering items). */
export function loadDeaths(): DeathEntry[] {
  return getMemory().deaths ?? [];
}

/** Adds a death to the log. */
export async function logDeath(death: DeathEntry): Promise<void> {
  await updateMemory({ deaths: [...loadDeaths(), death].slice(-DEATHS_KEPT) });
}

// --- Owner's last known position -------------------------------------------

export type SavedPosition = NonNullable<MemoryType["ownerPosition"]>;

const OWNER_SAVE_MIN_MS = 60 * 1000;
const OWNER_SAVE_MIN_BLOCKS = 8;

export function loadOwnerPosition(): SavedPosition | null {
  return getMemory().ownerPosition ?? null;
}

/**
 * Saves the owner's position. Positions the bot merely *sees* change all the
 * time, so those are only written when the owner moved a bit or a minute
 * passed; coordinates the owner typed (`force`) are always written.
 */
export async function saveOwnerPosition(position: SavedPosition, force = false): Promise<void> {
  const last = loadOwnerPosition();
  if (!force && last) {
    const moved = Math.hypot(position.x - last.x, position.y - last.y, position.z - last.z);
    if (moved < OWNER_SAVE_MIN_BLOCKS && position.at - last.at < OWNER_SAVE_MIN_MS) return;
  }
  await updateMemory({ ownerPosition: position });
}

// --- The bot's own bed (where its spawn point is) ------------------------------

export type SavedBed = NonNullable<MemoryType["bed"]>;

export function loadBed(): SavedBed | null {
  return getMemory().bed ?? null;
}

export async function saveBed(bed: SavedBed | null): Promise<void> {
  await updateMemory({ bed: bed ?? undefined });
}

// --- Chests it knows ------------------------------------------------------------

export type KnownChest = NonNullable<MemoryType["chests"]>[number];
const samePlace = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean =>
  a.x === b.x && a.y === b.y && a.z === b.z;

export function loadChests(): KnownChest[] {
  return getMemory().chests ?? [];
}

/** Remembers a chest and what's in it now (replacing what it knew about that spot). */
export async function rememberChest(chest: KnownChest): Promise<void> {
  const before = loadChests().find((c) => samePlace(c, chest));
  const others = loadChests().filter((c) => !samePlace(c, chest));
  // Once its own, always its own (opening it again doesn't say who placed it)
  const own = chest.own ?? before?.own;
  await updateMemory({ chests: [...others, own ? { ...chest, own } : chest] });
}

/** Forgets a chest (it was broken or isn't there any more). */
export async function forgetChest(at: { x: number; y: number; z: number }): Promise<void> {
  await updateMemory({ chests: loadChests().filter((c) => !samePlace(c, at)) });
}

// --- Conversation memory -----------------------------------------------------

export type Turn = { role: "owner" | "bot"; text: string; at: number };

const MAX_TURNS = 12; // about 6 exchanges
const MAX_TURN_CHARS = 200;
const CONVERSATION_EXPIRY_MS = 15 * 60 * 1000; // forget after 15 minutes of silence

// Loaded lazily: db.json is read at startup, after this module is imported
let conversation: Turn[] | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Recent turns, oldest first; everything is forgotten after 15 minutes of silence. */
export function recentConversation(): Turn[] {
  conversation ??= (getMemory().conversation ?? []) as Turn[];
  const last = conversation.at(-1);
  if (last && Date.now() - last.at > CONVERSATION_EXPIRY_MS) conversation = [];
  return conversation;
}

/** Adds what the owner said or what the bot replied (chat and whispers). */
export function recordTurn(role: Turn["role"], text: string): void {
  const clean = text.trim().slice(0, MAX_TURN_CHARS);
  if (!clean) return;
  const turns = recentConversation(); // also drops an expired conversation
  const previous = turns.at(-1);
  if (previous && previous.role === role && previous.text === clean) return;
  conversation = [...turns, { role, text: clean, at: Date.now() }].slice(-MAX_TURNS);

  // Save at most once every few seconds; chat comes in bursts
  if (!saveTimer) {
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void updateMemory({ conversation: conversation ?? [] });
    }, 3000);
  }
}
