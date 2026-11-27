// Path: src/actions/drowningReflex.ts
// Survival reflex: when the bot is underwater and running out of air, it stops
// whatever it is doing and swims straight up until it can breathe again.
// Without this the bot sinks and drowns as soon as a path fails in deep water
// (nothing holds the jump key once the pathfinder gives up).

import { bot, onConnectionEnd } from "../core/body";
import { Vec3 } from "vec3";
import { lookToward, setControl } from "../core/primitives";
import { avoidStep } from "../core/movements";
import { pathing, takeOverBody } from "../core/plugins";
import { asReflex, isAnyReflexActive, setReflexActive } from "../core/reflexes";
import { isLavaReflexActive } from "./lavaReflex";

const CHECK_MS = 250;
// Air in ticks (full is 300 = 15 s). mineflayer's bot.oxygenLevel can't be
// trusted: it is overwritten by the air of every entity around (fish, mobs),
// so the bot's own value is read from its metadata (index 1, air_supply)
const FULL_AIR = 300;
const LOW_AIR = 180; // about 9 seconds left
const SAFE_AIR = 270;
// Backup when the air value is missing: underwater this long counts as low
const MAX_UNDERWATER_MS = 5000;

// Blocks the bot's head can be "in water" inside of
const WATER_BLOCKS = new Set(["water", "bubble_column", "kelp", "kelp_plant", "seagrass", "tall_seagrass"]);

let active = false;
let floating = false;
let underwaterSince: number | null = null;
let lastWayLogAt = 0;

/** The bot's own air in ticks (300 when full or unknown). */
function ownAir(): number {
  const value = (bot.entity.metadata as unknown[] | undefined)?.[1];
  return typeof value === "number" ? value : FULL_AIR;
}

/** True while the bot is swimming up for air (other code should wait). */
export function isDrowningReflexActive(): boolean {
  return active;
}

function isWaterAt(dy: number): boolean {
  const block = bot.blockAt(bot.entity.position.offset(0, dy, 0));
  if (!block) return false;
  if (WATER_BLOCKS.has(block.name)) return true;
  return (block.getProperties() as { waterlogged?: boolean }).waterlogged === true;
}

const headUnderwater = (): boolean => isWaterAt(1.62);

/** A block as the drop check sees it: its name, its collision, and (water) its level. */
export type CellLook = { name: string; boundingBox: string; level?: number } | null;

/**
 * True when the cells straight down from the spot ahead (its own height
 * first, then up to 3 below) hold no floor: nothing solid, and no still
 * water over something solid. Flowing and falling water are no floor: at the
 * top of a waterfall the spot ahead is water, and pushing on into it it fell
 * ten blocks, three times, and died (owner's game). Pure.
 */
export function isDropAhead(column: CellLook[]): boolean {
  for (let i = 0; i < column.length; i++) {
    const b = column[i];
    if (!b) return true; // not loaded: don't go
    if (b.boundingBox === "block") return false;
    if (WATER_BLOCKS.has(b.name) && (b.level ?? 0) === 0 && column.slice(i + 1).some((c) => c?.boundingBox === "block")) return false;
  }
  return true;
}

/** A cell as the way-to-air search sees it (null: not loaded). */
export type WaterCell = { water: boolean; open: boolean; level: number; solid?: boolean } | null;
type P = { x: number; y: number; z: number };

/**
 * The way to air: a search through still water from the bot's feet cell for
 * the nearest spot where it can breathe (its body fits, the cell over its head
 * is open air, and it's water or stands on something). Returns the path from
 * the start (inclusive), or null when there's none within `maxCells`. The
 * bot is two cells tall, so every cell on the way needs room above it too.
 * Falling water (level 8 and up) is left out: a waterfall carries it off
 * (owner's game); flowing water is fine (a tunnel into an aquifer fills
 * with it, and that's the way back).
 * Pure over `look`.
 *
 * Game test: under a dirt ceiling in a two-high pocket the reflex held
 * "up" and pushed forward the way it happened to face, into a wall, for 19
 * seconds, and drowned with air a few blocks to the side.
 */
export function wayToAir(start: P, look: (x: number, y: number, z: number) => WaterCell, maxCells = 600): P[] | null {
  const key = (p: P): string => `${p.x},${p.y},${p.z}`;
  const fits = (p: P): boolean => {
    const feet = look(p.x, p.y, p.z);
    const head = look(p.x, p.y + 1, p.z);
    const still = (c: WaterCell): boolean => c !== null && (c.open || (c.water && c.level < 8));
    return still(feet) && still(head);
  };
  const breathes = (p: P): boolean => {
    const head = look(p.x, p.y + 1, p.z);
    if (!head || !head.open) return false;
    const feet = look(p.x, p.y, p.z);
    if (feet?.water) return true;
    const below = look(p.x, p.y - 1, p.z);
    // Air: only standing on something (never over a drop, never on lava)
    return below !== null && (below.solid ?? !below.open);
  };
  const from = new Map<string, P | null>([[key(start), null]]);
  const queue: P[] = [start];
  for (let i = 0; i < queue.length && from.size <= maxCells; i++) {
    const p = queue[i]!;
    if (breathes(p)) {
      const path: P[] = [];
      for (let c: P | null = p; c; c = from.get(key(c)) ?? null) path.unshift(c);
      return path;
    }
    // Up first: straight up is the usual way out
    for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]] as const) {
      const n = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
      if (from.has(key(n)) || !fits(n)) continue;
      from.set(key(n), p);
      queue.push(n);
    }
  }
  return null;
}

/** The search's view of a cell in the live world. */
function waterCellAt(x: number, y: number, z: number): WaterCell {
  const b = bot.blockAt(new Vec3(x, y, z));
  if (!b) return null;
  const props = b.getProperties() as { level?: number | string; waterlogged?: boolean };
  // Water it can swim in: a waterlogged stair or slab is a block in its way
  const water = (WATER_BLOCKS.has(b.name) || props.waterlogged === true) && b.boundingBox === "empty";
  const level = b.name === "water" ? Number(props.level ?? 0) : 0;
  const hot = b.name === "lava" || b.name === "fire" || b.name === "magma_block";
  return { water, open: !water && !hot && b.boundingBox === "empty", level, solid: b.boundingBox === "block" && b.name !== "magma_block" };
}

/** The drop check at the spot 0.8 ahead of where it faces. */
function dropAhead(): boolean {
  const p = bot.entity.position;
  const ahead = new Vec3(p.x - Math.sin(bot.entity.yaw) * 0.8, p.y, p.z - Math.cos(bot.entity.yaw) * 0.8).floored();
  const column: CellLook[] = [0, -1, -2, -3].map((dy) => {
    const b = bot.blockAt(ahead.offset(0, dy, 0));
    if (!b) return null;
    const level = Number((b.getProperties() as { level?: number | string }).level ?? 0);
    return { name: b.name, boundingBox: b.boundingBox, level };
  });
  return isDropAhead(column);
}

let diggingUp = false;

/** The block over its head (or the one over that) dug out, so there's air above. */
async function digUpForAir(feet: Vec3): Promise<void> {
  if (diggingUp) return;
  const head = feet.offset(0, 1, 0);
  const cell = [head.offset(0, 1, 0), head.offset(0, 2, 0)].find((c) => bot.blockAt(c)?.boundingBox === "block");
  if (!cell) return;
  const b = bot.blockAt(cell)!;
  if (b.name === "bedrock" || /lava|magma/.test(bot.blockAt(cell.offset(0, 1, 0))?.name ?? "")) return;
  diggingUp = true;
  try {
    const { breakBlock } = await import("../core/primitives");
    const broken = await asReflex("drowning", () => breakBlock(cell, { allowWithoutHarvest: true, intoLiquid: true }));
    console.log(broken.ok ? `Drowning reflex: no way to air; dug the ${b.name} over my head at ${cell}.` : `Drowning reflex: couldn't dig the ${b.name} over my head (${broken.ok ? "" : broken.detail}).`);
  } finally {
    diggingUp = false;
  }
}

function finish(): void {
  if (!active) return;
  active = false;
  setReflexActive("drowning", false);
  // Another reflex holding the body (lava) keeps its keys
  if (!isAnyReflexActive()) {
    setControl("jump", false);
    setControl("forward", false);
  }
  pathing.resumeAfterReflex();
  console.log("Drowning reflex: breathing again.");
  // Under again and again in the same water (game test: 20 minutes in a
  // canyon's water): out onto dry land first, whatever the task wanted
  const now = Date.now();
  surfacings = surfacings.filter((t) => now - t < 90_000).concat(now);
  if (surfacings.length >= 2 && !gettingOut) void getOntoLand();
}

let surfacings: number[] = [];
let gettingOut = false;

/** The block between it and the shore, at its head and over it, dug out (its way out of walled-in water). */
async function digTowardShore(land: Vec3): Promise<void> {
  const me = bot.entity.position;
  const dx = land.x + 0.5 - me.x;
  const dz = land.z + 0.5 - me.z;
  const step = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx), 0, 0) : new Vec3(0, 0, Math.sign(dz));
  const head = me.offset(0, 1.62, 0).floored();
  const { breakBlock } = await import("../core/primitives");
  for (const cell of [head.plus(step), head.offset(0, 1, 0), head.plus(step).offset(0, 1, 0)]) {
    const b = bot.blockAt(cell);
    if (!b || b.boundingBox !== "block" || b.name === "bedrock") continue;
    const broken = await breakBlock(cell, { allowWithoutHarvest: true, intoLiquid: true });
    console.log(broken.ok ? `Drowning reflex: dug the ${b.name} at ${cell} on my way out of the water.` : `Drowning reflex: couldn't dig the ${b.name} at ${cell} (${broken.detail}).`);
  }
}

/** The nearest dry spot to stand on (solid ground, open feet and head, no water) within 24 blocks. */
function nearestDryLand(): Vec3 | null {
  const me = bot.entity.position;
  const ground = bot.findBlocks({ matching: (b) => b !== null && b.boundingBox === "block", maxDistance: 24, count: 2000, point: me });
  let best: Vec3 | null = null;
  for (const g of ground) {
    const feet = bot.blockAt(g.offset(0, 1, 0));
    const head = bot.blockAt(g.offset(0, 2, 0));
    if (!feet || !head || feet.boundingBox !== "empty" || head.boundingBox !== "empty") continue;
    if (/water|lava/.test(feet.name) || /water|lava/.test(head.name)) continue;
    if (!best || g.distanceTo(me) < best.distanceTo(me)) best = g.offset(0, 1, 0);
  }
  return best;
}

/**
 * Swims out of the water to the nearest dry land, steering itself (game
 * test: the walk planner, asked for the shore 7 blocks up, kept sinking it
 * in the same spot): jump held to swim up, facing the shore, forward, until
 * it stands on dry ground or 25 seconds pass.
 */
async function getOntoLand(): Promise<void> {
  if (gettingOut) return;
  gettingOut = true;
  try {
    const land = nearestDryLand();
    if (!land) return;
    console.log(`Drowning reflex: in the water again and again; swimming out onto dry land at ${land}.`);
    await asReflex("drowning", async () => {
      setReflexActive("drowning", true);
      takeOverBody();
      try {
        const until = Date.now() + 25_000;
        let lastDig = Date.now();
        let lastSpot = bot.entity.position.clone();
        while (Date.now() < until && bot.entity && bot.health > 0) {
          const me = bot.entity.position;
          // Walled in (it sealed a canyon round its own water): not getting
          // anywhere for 6 seconds, it digs the way toward the shore open
          if (Date.now() - lastDig > 6_000) {
            if (me.distanceTo(lastSpot) < 1) await digTowardShore(land);
            lastDig = Date.now();
            lastSpot = me.clone();
          }
          const feetWet = isWaterAt(0.2);
          if (!feetWet && bot.entity.onGround && Math.hypot(land.x + 0.5 - me.x, land.z + 0.5 - me.z) < 1.5) break;
          const dx = land.x + 0.5 - me.x;
          const dz = land.z + 0.5 - me.z;
          await lookToward(Math.atan2(-dx, -dz), 0);
          // Up while the shore is above it, forward once level with it or near
          setControl("jump", feetWet || me.y < land.y);
          setControl("forward", Math.hypot(dx, dz) > 0.6);
          await new Promise((r) => setTimeout(r, 100));
        }
      } finally {
        setControl("jump", false);
        setControl("forward", false);
        setReflexActive("drowning", false);
      }
    });
    const out = !isWaterAt(0.2);
    console.log(out ? `Drowning reflex: out of the water at ${bot.entity.position.floored()}.` : "Drowning reflex: still in the water; trying again next time.");
    if (out) {
      surfacings = [];
      pathing.resumeAfterReflex();
    }
  } finally {
    gettingOut = false;
  }
}

function tick(): void {
  if (!bot.entity || !(bot.health > 0)) return;
  const air = ownAir();
  const underwater = headUnderwater();
  underwaterSince = underwater ? (underwaterSince ?? Date.now()) : null;
  const longUnderwater = underwaterSince !== null && Date.now() - underwaterSince > MAX_UNDERWATER_MS;

  // Idle in deep water: tread water instead of sinking (the pathfinder
  // swims on its own while it's walking somewhere)
  // (set every tick, not only on a change: another reflex's keys may have
  // let go of it meanwhile, and it sank under a creeper reflex holding it)
  const shouldFloat = !active && !bot.vehicle && isWaterAt(0.2) && !pathing.isMoving() && !isLavaReflexActive();
  if (shouldFloat) setControl("jump", true);
  else if (floating) setControl("jump", false);
  floating = shouldFloat;

  if (!active) {
    if (!underwater || (air > LOW_AIR && !longUnderwater)) return;
    floating = false;
    active = true;
    const at = (dy: number): string => bot.blockAt(bot.entity.position.offset(0, dy, 0))?.name ?? "?";
    console.log(
      `Drowning reflex: underwater with ${Math.round(air / 15)}/20 air, swimming up ` +
        `(at ${bot.entity.position.toString()}, feet ${at(0.2)}, head ${at(1.62)}, above ${at(2.6)}, ` +
        `jump ${bot.getControlState("jump")}, pathing ${pathing.isMoving()}, vy ${bot.entity.velocity.y.toFixed(2)}).`
    );
    // Out of air on a walk: the way went through water too deep to breathe
    // in (up a waterfall); the next walks go another way for a while
    if (pathing.isMoving()) {
      const feet = bot.entity.position.floored();
      for (let dy = -3; dy <= 1; dy++) if (isWaterAt(dy + 0.2)) avoidStep(feet.offset(0, dy, 0));
    }
    setReflexActive("drowning", true);
    takeOverBody(); // take over movement from whatever task is running
  }

  if (!underwater && air >= SAFE_AIR) {
    finish();
    return;
  }
  // Swim the way to air: jump is "swim up" in water; facing the next cell to
  // the side and pushing forward takes it out from under a ceiling. With no
  // way found, up and forward as before (never off a drop)
  const feet = bot.entity.position.floored();
  const path = wayToAir({ x: feet.x, y: feet.y, z: feet.z }, waterCellAt);
  const aside = path?.find((c) => c.x !== feet.x || c.z !== feet.z);
  const next = path?.[1];
  if (aside) {
    const dx = aside.x + 0.5 - bot.entity.position.x;
    const dz = aside.z + 0.5 - bot.entity.position.z;
    void lookToward(Math.atan2(-dx, -dz), 0);
    setControl("jump", !next || next.y >= feet.y);
    setControl("forward", underwater || !dropAhead());
  } else {
    void lookToward(bot.entity.yaw, Math.PI / 4);
    setControl("jump", true);
    setControl("forward", !path && !dropAhead());
    // No way to air and a block over its head: dig it out. Water never flows
    // up, so the cell it opens is air to put its head in (game test: in its
    // flooded mine, stone overhead, it pushed up against it and drowned, twice)
    if (!path && underwater) void digUpForAir(feet);
  }
  if (path && path.length > 1 && aside && Date.now() - lastWayLogAt > 3_000) {
    lastWayLogAt = Date.now();
    const end = path[path.length - 1]!;
    console.log(`Drowning reflex: a ceiling over me; swimming to air at (${end.x}, ${end.y}, ${end.z}), ${path.length - 1} cells.`);
  }
}

/** Starts the reflex for the current bot instance. */
export function registerDrowningReflex(): void {
  active = false; // fresh state for this connection
  floating = false;
  underwaterSince = null;
  // Its moves run as the drowning reflex: they never wait for the task it paused
  const timer = setInterval(() => asReflex("drowning", tick), CHECK_MS);
  onConnectionEnd(bot, () => clearInterval(timer));
  bot.on("death", () => asReflex("drowning", finish));
}
