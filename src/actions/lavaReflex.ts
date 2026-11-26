// Path: src/actions/lavaReflex.ts
// Survival reflex: the moment the bot touches lava it stops whatever it's
// doing and gets out, to the nearest ground with no lava around it; walks
// route around that spot for a while. Still burning once out (lava sets it
// on fire for several seconds), it heads for water close by to put it out.
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
import { asReflex, isAnyReflexActive, setReflexActive } from "../core/reflexes";

// Lava does 4 damage every half second: check often
const CHECK_MS = 100;
// Out of the lava this long before it lets go (it can bob back in)
const CLEAR_MS = 600;
// The bot's box: 0.6 wide (the game takes a hair off each side), 1.8 tall
const HALF_WIDTH = 0.299;
const HEIGHT = 1.799;
// Never holds the body longer than this (a spot it can't get out of: the
// walk's own stuck handling takes over), then not again for a moment
const MAX_ACTIVE_MS = 20_000;
const REST_AFTER_CAP_MS = 5_000;
// Water this close (cells searched) is worth going to while burning
const WATER_SEARCH_CELLS = 300;
// A lava cell costs this many open cells (the bot moves slowly in lava, at
// 4 damage every half second)
const LAVA_COST = 6;

let active = false;
let activeSince = 0;
let clearSince: number | null = null;
let restUntil = 0;
let lastLogAt = 0;
let lastLavaAt = 0;

/** True while the bot is getting out of lava or putting out its fire (other code should wait). */
export function isLavaReflexActive(): boolean {
  return active;
}

/** When it last touched lava (0: not this connection). A death right after is a death in lava: its things burned. */
export function lastTouchedLavaAt(): number {
  return lastLavaAt;
}

/**
 * A cell as the searches see it (null: not loaded). `open`: room for a body,
 * no water, nothing hot. `solid`: something to stand on (magma too: `hot`
 * says it's no place to stop).
 */
export type LavaCell = { lava: boolean; open: boolean; solid: boolean; water?: boolean; hot?: boolean } | null;
type P = { x: number; y: number; z: number };
type Look = (x: number, y: number, z: number) => LavaCell;

const SIDES = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;
const AROUND = [...SIDES, [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1]] as const;

/**
 * The cells the bot's box overlaps at `pos` that `matches` (lava). Pure over
 * `matches`.
 */
export function touchingCells(pos: P, matches: (x: number, y: number, z: number) => boolean): P[] {
  const cells: P[] = [];
  for (let x = Math.floor(pos.x - HALF_WIDTH); x <= Math.floor(pos.x + HALF_WIDTH); x++) {
    for (let z = Math.floor(pos.z - HALF_WIDTH); z <= Math.floor(pos.z + HALF_WIDTH); z++) {
      for (let y = Math.floor(pos.y); y <= Math.floor(pos.y + HEIGHT); y++) {
        if (matches(x, y, z)) cells.push({ x, y, z });
      }
    }
  }
  return cells;
}

/**
 * A way through lava and open cells the way a body can move there: rising
 * through lava or water any height, jumping out of it (or off the ground) one
 * block, sideways only with lava, water or ground under it, and down. Lava
 * cells cost more than open ones. Returns the cheapest path from `start`
 * (inclusive) to a cell `goal` accepts, or null within `maxCells`. Pure over
 * `look`.
 */
export function findWay(start: P, look: Look, goal: (p: P) => boolean, maxCells = 800): P[] | null {
  const key = (p: P): string => `${p.x},${p.y},${p.z}`;
  const fluid = (c: LavaCell): boolean => c !== null && (c.lava || c.water === true);
  const passable = (c: LavaCell): boolean => c !== null && (c.open || fluid(c));
  const fits = (p: P): boolean => passable(look(p.x, p.y, p.z)) && passable(look(p.x, p.y + 1, p.z));
  // Something to push off or swim in: its feet in lava or water, or ground under it
  const footing = (p: P): boolean => fluid(look(p.x, p.y, p.z)) || look(p.x, p.y - 1, p.z)?.solid === true;
  // Somewhere it can move sideways from or into without falling: that, or lava/water under it
  const carried = (p: P): boolean => footing(p) || fluid(look(p.x, p.y - 1, p.z));
  const cost = (p: P): number => (look(p.x, p.y, p.z)?.lava || look(p.x, p.y + 1, p.z)?.lava ? LAVA_COST : 1);

  const dist = new Map<string, number>([[key(start), 0]]);
  const from = new Map<string, P | null>([[key(start), null]]);
  const done = new Set<string>();
  // A small binary heap would do; the searches stay under a thousand cells
  const open: Array<{ p: P; d: number }> = [{ p: start, d: 0 }];
  while (open.length > 0 && done.size <= maxCells) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.d < open[best]!.d) best = i;
    const { p, d } = open.splice(best, 1)[0]!;
    const k = key(p);
    if (done.has(k)) continue;
    done.add(k);
    if (goal(p)) {
      const path: P[] = [];
      for (let c: P | null = p; c; c = from.get(key(c)) ?? null) path.unshift(c);
      return path;
    }
    const steps: P[] = [];
    for (const [dx, , dz] of SIDES) steps.push({ x: p.x + dx, y: p.y, z: p.z + dz });
    steps.push({ x: p.x, y: p.y - 1, z: p.z });
    // Up: through lava or water any height; into open air one jump, from footing
    const up = { x: p.x, y: p.y + 1, z: p.z };
    if (fluid(look(up.x, up.y, up.z)) || footing(p)) steps.push(up);
    for (const n of steps) {
      if (done.has(key(n)) || !fits(n)) continue;
      // Sideways only where it doesn't drop (its own cell carried it too)
      if (n.y === p.y && !(carried(n) && carried(p))) continue;
      const nd = d + cost(n);
      if (nd >= (dist.get(key(n)) ?? Infinity)) continue;
      dist.set(key(n), nd);
      from.set(key(n), p);
      open.push({ p: n, d: nd });
    }
  }
  return null;
}

/**
 * Ground safe from lava: room for its body with no lava or fire in it, solid
 * ground under it (not magma), and no lava in the eight cells around its
 * feet or head (its box reaches into them). Pure over `look`.
 */
export function safeFromLava(p: P, look: Look): boolean {
  const feet = look(p.x, p.y, p.z);
  const head = look(p.x, p.y + 1, p.z);
  const below = look(p.x, p.y - 1, p.z);
  const clear = (c: LavaCell): boolean => c !== null && !c.lava && (c.open || c.water === true);
  if (!clear(feet) || !clear(head) || !below?.solid || below.hot) return false;
  return AROUND.every(([dx, , dz]) => !look(p.x + dx, p.y, p.z + dz)?.lava && !look(p.x + dx, p.y + 1, p.z + dz)?.lava);
}

/** The way out of lava: to the nearest ground safe from it. Pure over `look`. */
export function wayOutOfLava(start: P, look: Look, maxCells = 800): P[] | null {
  return findWay(start, look, (p) => safeFromLava(p, look), maxCells);
}

/** The search's view of a cell in the live world, read once per tick. */
function liveLook(): Look {
  const seen = new Map<string, LavaCell>();
  return (x, y, z) => {
    const k = `${x},${y},${z}`;
    if (seen.has(k)) return seen.get(k)!;
    const b = bot.blockAt(new Vec3(x, y, z));
    let cell: LavaCell = null;
    if (b) {
      const lava = b.name === "lava";
      const water = b.name === "water" || b.name === "bubble_column";
      const hot = lava || b.name === "fire" || b.name === "soul_fire" || b.name === "magma_block";
      cell = { lava, water, hot, open: !hot && !water && b.boundingBox === "empty", solid: b.boundingBox === "block" };
    }
    seen.set(k, cell);
    return cell;
  };
}

/** True while the bot is on fire (entity flags, bit 0). */
function onFire(): boolean {
  const flags = (bot.entity.metadata as unknown[] | undefined)?.[0];
  return typeof flags === "number" && (flags & 0x01) !== 0;
}

function finish(reason = "out of the lava"): void {
  if (!active) return;
  active = false;
  clearSince = null;
  setReflexActive("lava", false);
  // Another reflex holding the body keeps its keys (it sets them again anyway)
  if (!isAnyReflexActive()) {
    setControl("jump", false);
    setControl("forward", false);
  }
  pathing.resumeAfterReflex();
  console.log(`Lava reflex: ${reason}.`);
}

/** Steers along a path: faces the first cell to the side, jumps unless the next step is down. */
function steer(path: P[] | null, feet: P): void {
  const aside = path?.find((c) => c.x !== feet.x || c.z !== feet.z);
  const next = path?.[1];
  if (aside) {
    const dx = aside.x + 0.5 - bot.entity.position.x;
    const dz = aside.z + 0.5 - bot.entity.position.z;
    void lookToward(Math.atan2(-dx, -dz), 0);
    setControl("forward", true);
    setControl("jump", !next || next.y >= feet.y);
  } else if (path && path.length === 1) {
    // On the safe cell already, but its box still reaches the lava: to the cell's middle
    const dx = feet.x + 0.5 - bot.entity.position.x;
    const dz = feet.z + 0.5 - bot.entity.position.z;
    const off = Math.hypot(dx, dz) > 0.15;
    if (off) void lookToward(Math.atan2(-dx, -dz), 0);
    setControl("forward", off);
    setControl("jump", false);
  } else {
    // Straight up, or no way found: up
    setControl("jump", true);
    setControl("forward", false);
  }
}

function tick(): void {
  if (!bot.entity || !(bot.health > 0)) return;
  const look = liveLook();
  const pos = bot.entity.position;
  const touching = touchingCells(pos, (x, y, z) => look(x, y, z)?.lava === true);
  if (touching.length > 0) lastLavaAt = Date.now();
  const burning = onFire();
  if (!active) {
    if (touching.length === 0 || Date.now() < restUntil) return;
    active = true;
    activeSince = Date.now();
    clearSince = null;
    console.log(`Lava reflex: touching lava at ${touching.map((c) => `(${c.x}, ${c.y}, ${c.z})`).join(" ")}, getting out (health ${bot.health.toFixed(1)}).`);
    setReflexActive("lava", true);
    takeOverBody(); // take over movement from whatever task is running
  }
  if (Date.now() - activeSince > MAX_ACTIVE_MS) {
    restUntil = Date.now() + REST_AFTER_CAP_MS;
    finish(`gave up after ${MAX_ACTIVE_MS / 1000} s`);
    return;
  }
  // Walks route around it from now on (and around the cells around it)
  for (const c of touching) {
    avoidStep(c);
    for (const [dx, , dz] of SIDES) avoidStep({ x: c.x + dx, y: c.y, z: c.z + dz });
  }
  const feet = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
  if (touching.length === 0) {
    clearSince ??= Date.now();
    if (Date.now() - clearSince < CLEAR_MS) {
      steer(wayOutOfLava(feet, look), feet);
      return;
    }
    // Out, but burning: water close by puts it out; none near, nothing to wait for
    const water = burning ? findWay(feet, look, (p) => look(p.x, p.y, p.z)?.water === true, WATER_SEARCH_CELLS) : null;
    if (!water) {
      finish(burning ? "out of the lava (burning, no water near)" : "out of the lava");
      return;
    }
    steer(water, feet);
    if (Date.now() - lastLogAt > 2_000) {
      lastLogAt = Date.now();
      console.log(`Lava reflex: on fire; to the water at (${water.at(-1)!.x}, ${water.at(-1)!.y}, ${water.at(-1)!.z}).`);
    }
    return;
  }
  clearSince = null;
  const path = wayOutOfLava(feet, look);
  steer(path, feet);
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
  restUntil = 0;
  lastLogAt = 0;
  lastLavaAt = 0;
  // Its moves run as the lava reflex: they never wait for the task it paused
  const timer = setInterval(() => asReflex("lava", tick), CHECK_MS);
  onConnectionEnd(bot, () => clearInterval(timer));
  bot.on("death", () => asReflex("lava", () => finish("died")));
}
