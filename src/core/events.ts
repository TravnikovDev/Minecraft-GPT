// Path: src/core/events.ts
// A small typed event bus. The Body turns raw mineflayer events into these
// game-level events; the rest of the bot subscribes here instead of to the
// mineflayer instance (which is replaced on every reconnect). Listeners are
// guarded: a throwing or rejecting listener is logged, never propagated.

import type { Vec3 } from "vec3";

export interface BotEvents {
  /** First spawn of a connection, and every respawn after death. */
  "bot:spawned": { position: Vec3 | null };
  /** The bot died (it respawns automatically). */
  "bot:died": { position: Vec3 | null };
  /** Health dropped. */
  "bot:damaged": { amount: number; health: number };
  /** A block changed; selfCaused when it was the bot's own dig/place. */
  "block:changed": { position: Vec3; from: string; to: string; selfCaused: boolean };
  /** The bot picked up an item (from the ground or a gift). */
  /** `from`: the player who threw it (it appeared at their hands), if anyone. */
  "item:collected": { name: string; count: number; from: string | null };
}

type Listener<K extends keyof BotEvents> = (payload: BotEvents[K]) => unknown;

const listeners: { [K in keyof BotEvents]?: Array<Listener<K>> } = {};

/** Subscribes to a bot event. Returns a function that unsubscribes. */
export function on<K extends keyof BotEvents>(event: K, listener: Listener<K>): () => void {
  const list = (listeners[event] ??= []) as Array<Listener<K>>;
  list.push(listener);
  return () => {
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
  };
}

/** Emits a bot event to every listener (errors are logged, not thrown). */
export function emit<K extends keyof BotEvents>(event: K, payload: BotEvents[K]): void {
  for (const listener of [...((listeners[event] ?? []) as Array<Listener<K>>)]) {
    try {
      const result = listener(payload);
      if (result instanceof Promise) {
        result.catch((error) => console.error(`Listener for "${event}" failed:`, error));
      }
    } catch (error) {
      console.error(`Listener for "${event}" failed:`, error);
    }
  }
}

// --- Self-caused block changes ---------------------------------------------

// The bot's own digs/places, so their block updates aren't mistaken for the
// world changing on its own (which would e.g. trigger a needless replan)
const SELF_ACTION_WINDOW_MS = 3000;
const recentSelfActions = new Map<string, number>();
const key = (p: { x: number; y: number; z: number }): string =>
  `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;

/** Call right before the bot digs or places at a position. */
export function markSelfAction(position: { x: number; y: number; z: number }): void {
  recentSelfActions.set(key(position), Date.now());
}

/** True if this block position was the bot's own dig/place in the last few seconds. */
export function isSelfCaused(position: { x: number; y: number; z: number }): boolean {
  const at = recentSelfActions.get(key(position));
  if (at === undefined) return false;
  if (Date.now() - at > SELF_ACTION_WINDOW_MS) {
    recentSelfActions.delete(key(position));
    return false;
  }
  return true;
}
