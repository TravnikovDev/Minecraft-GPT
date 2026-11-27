// Path: src/managers/stuckWatch.ts
// Getting unstuck as a service (Phase 4): watches the running task's
// progress (moving, or items coming and going) and, when there's none for a
// while, escalates like a player would: a nudge (jump, step aside), then
// planning the route again, then giving up on the task. Giving up remembers
// the place it was trying to reach as unreachable for a while (core/failures),
// so walking there again fails at once instead of getting stuck again.

import { isDrowningReflexActive } from "../actions/drowningReflex";
import { bot } from "../core/body";
import { cancelRunning, currentTask, onTaskStart } from "../core/arbiter";
import { isAnyReflexActive } from "../core/reflexes";
import { pathing } from "../core/plugins";
import { lastWalkGoal } from "../core/primitives";
import { placeKey, rememberFailure } from "../core/failures";
import { nudge } from "../actions/unstuck";

/** No progress for this long: the next step up. */
const NO_PROGRESS_MS = 45_000;
/** A spot given up on stays "unreachable" this long. */
const FORGET_AFTER_MS = 10 * 60_000;

let lastProgressAt = Date.now();
let lastPos = { x: 0, y: 0, z: 0 };
let lastInventory = "";
let level = 0; // 0 fine, 1 nudged, 2 replanned
let busy = false;

const inventorySignature = (): string =>
  bot.inventory
    .items()
    .map((i) => `${i.name}:${i.count}`)
    .sort()
    .join(",");

function restart(): void {
  lastProgressAt = Date.now();
  level = 0;
  const p = bot.entity?.position;
  if (p) lastPos = { x: p.x, y: p.y, z: p.z };
  lastInventory = bot.inventory ? inventorySignature() : "";
}

// A reflex holding it in one spot longer than this no longer counts as progress
const REFLEX_HOLD_MAX_MS = 90_000;
let reflexSince: number | null = null;

// A task waiting on purpose (by a blaze spawner, for the dragon to land)
// says so: standing still then is not being stuck
let holdUntil = 0;

/** A task holds its position on purpose for `ms` (call it again while it keeps waiting). */
export function holdPosition(ms = 10_000): void {
  holdUntil = Math.max(holdUntil, Date.now() + ms);
}

/** True when the bot moved or its items changed since last time (a reflex holding it, or a deliberate wait, counts as fine). */
function madeProgress(): boolean {
  const p = bot.entity?.position;
  if (!p) return true;
  if (Date.now() < holdUntil) return true;
  // Bobbing up and down in water isn't getting anywhere, nor is the drowning
  // reflex lifting it for air every few seconds (game test: 20 minutes in a
  // canyon's water, never seen as stuck)
  const moved = Math.hypot(p.x - lastPos.x, p.z - lastPos.z) > 1 || Math.abs(p.y - lastPos.y) > 3;
  const items = inventorySignature();
  // A reflex holding it counts as fine, but not for minutes on end in one
  // spot (game test: 4.5 minutes by a tree and never seen as stuck)
  const reflex = isAnyReflexActive() && !isDrowningReflexActive();
  if (reflex) reflexSince ??= Date.now();
  else reflexSince = null;
  const reflexTooLong = reflexSince !== null && Date.now() - reflexSince > REFLEX_HOLD_MAX_MS;
  if (moved || items !== lastInventory) reflexSince = reflex ? Date.now() : null;
  if (moved || items !== lastInventory || (reflex && !reflexTooLong)) {
    lastPos = { x: p.x, y: p.y, z: p.z };
    lastInventory = items;
    return true;
  }
  return false;
}

/** Called every few seconds: checks the running task and escalates when it's stuck. */
export async function checkProgress(): Promise<void> {
  const task = currentTask();
  if (!task || !task.watchProgress || busy || !bot.entity) return;
  if (madeProgress()) {
    lastProgressAt = Date.now();
    level = 0;
    return;
  }
  if (Date.now() - lastProgressAt < NO_PROGRESS_MS) return;
  busy = true;
  try {
    lastProgressAt = Date.now(); // each step gets its own while
    if (level === 0) {
      console.log(`No progress on ${task.name} for ${NO_PROGRESS_MS / 1000}s: nudging.`);
      level = 1;
      await nudge();
    } else if (level === 1) {
      console.log(`Still no progress on ${task.name}: planning the route again.`);
      level = 2;
      pathing.replan();
    } else {
      // Blame the place only if it's walking there right now
      const goal = pathing.isMoving() ? lastWalkGoal() : null;
      if (goal) rememberFailure(placeKey(goal), `got stuck going there`, FORGET_AFTER_MS);
      console.log(`Still stuck on ${task.name}: giving up${goal ? ` (${goal.x}, ${goal.y}, ${goal.z} unreachable for a while)` : ""}.`);
      if (task.bucket < 6) bot.chat(`I'm stuck, so I gave up on ${task.name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}.`);
      level = 0;
      await cancelRunning("stuck", false);
    }
  } catch (error) {
    console.error("Stuck watcher failed:", error);
  } finally {
    busy = false;
  }
}

// Every task starts with a clean slate
onTaskStart(() => restart());

/** A new connection: start over. */
export function resetStuckWatch(): void {
  restart();
}
