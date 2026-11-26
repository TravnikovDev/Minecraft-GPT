// Path: src/actions/lavaReflex.ts
// Survival reflex: the moment the bot touches lava it stops whatever it's
// doing and gets out, to the nearest ground with no lava beside it, and walks
// route around that spot for a while.
//
// Game test: a walk from deep in its mine to sheep 150 blocks away dug
// through deepslate and dropped into lava at y=-53; the bot stood there taking
// 3.8 damage every half second and died in 3 seconds with 49 items, which
// burned. Nothing in the bot knew to move.

import { Vec3 } from "vec3";
import { bot, onConnectionEnd } from "../core/body";
import { lookToward, setControl } from "../core/primitives";
import { avoidStep } from "../core/movements";
import { pathing, takeOverBody } from "../core/plugins";
import { asReflex, setReflexActive } from "../core/reflexes";

// Lava does 4 damage every half second: check often
const CHECK_MS = 100;
// Out of the lava this long before it lets go (it can bob back in)
const CLEAR_MS = 600;
// How far its body reaches from its centre (0.3) plus a hair, to catch lava
// beside it before it's fully in
const HALF_WIDTH = 0.35;
const HEIGHT = 1.8;

let active = false;
let clearSince: number | null = null;
let lastLogAt = 0;

/** True while the bot is getting out of lava (other code should wait). */
export function isLavaReflexActive(): boolean {
  return active;
}

/** A cell as the way-out search sees it (null: not loaded). */
export type LavaCell = { lava: boolean; open: boolean; solid: boolean } | null;
type P = { x: number; y: number; z: number };

const SIDES = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

/**
 * The way out of lava: a search from the bot's feet cell for the nearest spot
 * to stand: solid ground under it (not magma), room for its body, and no lava
 * in it or right beside it. It moves through open cells and lava (it can swim
 * through lava for a moment, not through stone). Returns the path from the
 * start (inclusive), or null when there's none within `maxCells`. Pure over
 * `look`.
 */
export function wayOutOfLava(start: P, look: (x: number, y: number, z: number) => LavaCell, maxCells = 800): P[] | null {
  const key = (p: P): string => `${p.x},${p.y},${p.z}`;
  const passable = (c: LavaCell): boolean => c !== null && (c.open || c.lava);
  const fits = (p: P): boolean => passable(look(p.x, p.y, p.z)) && passable(look(p.x, p.y + 1, p.z));
  const safe = (p: P): boolean => {
    const feet = look(p.x, p.y, p.z);
    const head = look(p.x, p.y + 1, p.z);
    const below = look(p.x, p.y - 1, p.z);
    if (!feet?.open || !head?.open || !below?.solid) return false;
    return SIDES.every(([dx, , dz]) => !look(p.x + dx, p.y, p.z + dz)?.lava && !look(p.x + dx, p.y + 1, p.z + dz)?.lava);
  };
  const from = new Map<string, P | null>([[key(start), null]]);
  const queue: P[] = [start];
  for (let i = 0; i < queue.length && from.size <= maxCells; i++) {
    const p = queue[i]!;
    if (safe(p)) {
      const path: P[] = [];
      for (let c: P | null = p; c; c = from.get(key(c)) ?? null) path.unshift(c);
      return path;
    }
    for (const [dx, dy, dz] of [...SIDES, [0, 1, 0], [0, -1, 0]] as const) {
      const n = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
      if (from.has(key(n)) || !fits(n)) continue;
      from.set(key(n), p);
      queue.push(n);
    }
  }
  return null;
}

/** The search's view of a cell in the live world. */
function lavaCellAt(x: number, y: number, z: number): LavaCell {
  const b = bot.blockAt(new Vec3(x, y, z));
  if (!b) return null;
  const lava = b.name === "lava";
  const hot = lava || b.name === "fire" || b.name === "soul_fire" || b.name === "magma_block";
  return { lava, open: !hot && b.boundingBox === "empty", solid: b.boundingBox === "block" && b.name !== "magma_block" };
}

/** The lava cells the bot's body touches now (its box, a hair wider). */
function lavaTouching(): Vec3[] {
  const p = bot.entity.position;
  const cells: Vec3[] = [];
  for (let x = Math.floor(p.x - HALF_WIDTH); x <= Math.floor(p.x + HALF_WIDTH); x++) {
    for (let z = Math.floor(p.z - HALF_WIDTH); z <= Math.floor(p.z + HALF_WIDTH); z++) {
      for (let y = Math.floor(p.y); y <= Math.floor(p.y + HEIGHT); y++) {
        const c = new Vec3(x, y, z);
        if (bot.blockAt(c)?.name === "lava") cells.push(c);
      }
    }
  }
  return cells;
}

function finish(): void {
  if (!active) return;
  active = false;
  clearSince = null;
  setControl("jump", false);
  setControl("forward", false);
  setReflexActive("lava", false);
  pathing.resumeAfterReflex();
  console.log("Lava reflex: out of the lava.");
}

function tick(): void {
  if (!bot.entity || !(bot.health > 0)) return;
  const touching = lavaTouching();
  if (!active) {
    if (touching.length === 0) return;
    active = true;
    clearSince = null;
    console.log(`Lava reflex: touching lava at ${touching.map((c) => c.toString()).join(" ")}, getting out (health ${bot.health.toFixed(1)}).`);
    setReflexActive("lava", true);
    takeOverBody(); // take over movement from whatever task is running
  }
  // Walks route around it from now on (and around the cells around it)
  for (const c of touching) {
    avoidStep(c);
    for (const [dx, , dz] of SIDES) avoidStep(c.offset(dx, 0, dz));
  }
  if (touching.length === 0) {
    clearSince ??= Date.now();
    if (Date.now() - clearSince >= CLEAR_MS) {
      finish();
      return;
    }
  } else {
    clearSince = null;
  }
  const feet = bot.entity.position.floored();
  const path = wayOutOfLava({ x: feet.x, y: feet.y, z: feet.z }, lavaCellAt);
  const target = path?.find((c) => c.x !== feet.x || c.z !== feet.z) ?? path?.at(-1);
  if (target && (target.x !== feet.x || target.z !== feet.z)) {
    const dx = target.x + 0.5 - bot.entity.position.x;
    const dz = target.z + 0.5 - bot.entity.position.z;
    void lookToward(Math.atan2(-dx, -dz), 0);
    setControl("forward", true);
    setControl("jump", true); // up out of the lava and over the lip
  } else {
    // Standing on the safe spot already, or no way found: up, then forward
    setControl("jump", true);
    setControl("forward", !path);
  }
  if (Date.now() - lastLogAt > 2_000) {
    lastLogAt = Date.now();
    const end = path?.at(-1);
    console.log(end ? `Lava reflex: heading for (${end.x}, ${end.y}, ${end.z}), ${path!.length - 1} cells.` : "Lava reflex: no way out found; jumping.");
  }
}

/** Starts the reflex for the current bot instance. */
export function registerLavaReflex(): void {
  active = false; // fresh state for this connection
  clearSince = null;
  lastLogAt = 0;
  // Its moves run as the lava reflex: they never wait for the task it paused
  const timer = setInterval(() => asReflex("lava", tick), CHECK_MS);
  onConnectionEnd(bot, () => clearInterval(timer));
  bot.on("death", () => asReflex("lava", finish));
}
