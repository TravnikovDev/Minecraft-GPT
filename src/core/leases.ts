// Path: src/core/leases.ts
// Who may use the bot's body right now (Phase 4). The body has a few shared
// resources: movement (walking, the pathfinder, movement keys), hands (the
// held item, digging, placing, using, eating), the open window (chests,
// furnaces, crafting) and the chat outbox. Code that uses one runs under a
// holder with a priority bucket (core/arbiter: survival 0 ... idle 6):
//
// - The running task holds everything at its bucket by default.
// - A reflex (a creeper, running out of air, a fight) takes what it needs
//   urgently: the task's next use of that resource waits until the reflex lets
//   go, and its current one is stopped by the reflex's takeover. So a reflex
//   pauses a task instead of aborting it.
// - A polite borrower (eating, putting armor on) waits until the resource is
//   between uses, takes it briefly, and gives it back.
//
// Kept free of imports from the rest of the bot (only the async context),
// so any core module can use it without a cycle.

import { AsyncLocalStorage } from "node:async_hooks";

export type Resource = "movement" | "hands" | "window" | "chat";
export const RESOURCES: Resource[] = ["movement", "hands", "window", "chat"];

/** Someone using the body: a task, a reflex, or a polite borrower. */
export type Holder = { name: string; bucket: number };

// Urgent holders per resource (reflexes and borrowers), highest priority wins
const held = new Map<Resource, Holder[]>();
// Uses in progress per resource (a primitive running), so borrowers can slot in between
const inUse = new Map<Resource, number>();
// Bumped when an urgent holder takes a resource, so an interrupted use can tell
const takeovers = new Map<Resource, number>();
// Borrowers waiting for a gap per resource: the task's next action lets them go first
const borrowersWaiting = new Map<Resource, number>();
const holderContext = new AsyncLocalStorage<Holder>();
let taskHolder: Holder | null = null;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The holder this code runs for: a reflex or borrower, else the running task, else idle. */
export function currentHolder(): Holder {
  return holderContext.getStore() ?? taskHolder ?? { name: "idle", bucket: 6 };
}

/** Runs `fn` as `holder` (reflexes and borrowers run their body this way). */
export function runAs<T>(holder: Holder, fn: () => T): T {
  return holderContext.run(holder, fn);
}

/** The arbiter tells us which task runs now (it holds every resource at its bucket). */
export function setTaskHolder(holder: Holder | null): void {
  taskHolder = holder;
}

/** The most urgent holder of a resource right now (an urgent one, else the task). */
export function holderOf(resource: Resource): Holder | null {
  const urgent = held.get(resource) ?? [];
  if (urgent.length > 0) return urgent.reduce((a, b) => (b.bucket < a.bucket ? b : a));
  return taskHolder;
}

/**
 * True when `me` may use the resource now. While nobody has taken it (no
 * reflex, no borrower), the running task and anything running alongside it
 * may; once someone has, only the most urgent of them (the first, on a tie).
 */
export function mayUse(resource: Resource, me: Holder = currentHolder()): boolean {
  const list = held.get(resource) ?? [];
  if (list.length === 0) return true;
  const top = list.reduce((a, b) => (b.bucket < a.bucket ? b : a));
  return top.name === me.name;
}

/** True while any urgent holder (a reflex) has the resource. */
export function isTakenUrgently(resource: Resource = "movement"): boolean {
  return (held.get(resource) ?? []).some((h) => h.bucket <= 1);
}

/**
 * Takes resources urgently (a reflex): from now on others wait for them.
 * The caller stops what the old holder was doing (the reflex's takeover).
 */
export function takeUrgently(holder: Holder, resources: Resource[]): void {
  for (const r of resources) {
    const list = held.get(r) ?? [];
    if (list.some((h) => h.name === holder.name)) continue;
    held.set(r, [...list, holder]);
    takeovers.set(r, (takeovers.get(r) ?? 0) + 1);
  }
}

/** Gives back resources taken urgently or borrowed. */
export function release(holder: Holder, resources: Resource[] = RESOURCES): void {
  for (const r of resources) held.set(r, (held.get(r) ?? []).filter((h) => h.name !== holder.name));
}

/** How many times someone took this resource urgently (compare before and after a use). */
export function takeoverCount(resource: Resource): number {
  return takeovers.get(resource) ?? 0;
}

/**
 * Waits until `me` may use the resource (a reflex has let go). Returns false
 * when `cancelled()` says to give up first.
 */
export async function waitTurn(resource: Resource, cancelled: () => boolean = () => false, me: Holder = currentHolder()): Promise<boolean> {
  // A borrower (eating) waiting for a gap goes before the task's next action;
  // an action nested in one already running never waits (it would deadlock)
  const yieldsToBorrower = (): boolean => me.bucket >= 2 && (borrowersWaiting.get(resource) ?? 0) > 0 && (inUse.get(resource) ?? 0) === 0;
  while (!mayUse(resource, me) || yieldsToBorrower()) {
    if (cancelled()) return false;
    await sleep(100);
  }
  return !cancelled();
}

/** Marks a use of the resource in progress (a primitive running); returns the end marker. */
export function beginUse(resource: Resource): () => void {
  inUse.set(resource, (inUse.get(resource) ?? 0) + 1);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    inUse.set(resource, Math.max(0, (inUse.get(resource) ?? 1) - 1));
  };
}

/**
 * Borrows resources politely for a short job (eating, putting armor on): waits
 * until nobody more urgent holds them and no use is in progress, holds them
 * while `job` runs (the task waits at its next use), then gives them back.
 * Gives up (returns null) after `maxWaitMs`.
 */
export async function borrow<T>(holder: Holder, resources: Resource[], job: () => Promise<T>, maxWaitMs = 10_000): Promise<T | null> {
  const end = Date.now() + maxWaitMs;
  for (const r of resources) borrowersWaiting.set(r, (borrowersWaiting.get(r) ?? 0) + 1);
  try {
    while (resources.some((r) => (inUse.get(r) ?? 0) > 0 || isTakenUrgently(r))) {
      if (Date.now() > end) return null;
      await sleep(25);
    }
    for (const r of resources) held.set(r, [...(held.get(r) ?? []), holder]);
  } finally {
    for (const r of resources) borrowersWaiting.set(r, Math.max(0, (borrowersWaiting.get(r) ?? 1) - 1));
  }
  try {
    return await runAs(holder, job);
  } finally {
    release(holder, resources);
  }
}

/** A new connection: nobody holds anything. */
export function resetLeases(): void {
  held.clear();
  inUse.clear();
  borrowersWaiting.clear();
  taskHolder = null;
}
