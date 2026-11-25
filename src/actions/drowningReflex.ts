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
import { asReflex, setReflexActive } from "../core/reflexes";

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

function finish(): void {
  if (!active) return;
  active = false;
  setControl("jump", false);
  setControl("forward", false);
  setReflexActive("drowning", false);
  pathing.resumeAfterReflex();
  console.log("Drowning reflex: breathing again.");
}

function tick(): void {
  if (!bot.entity || !(bot.health > 0)) return;
  const air = ownAir();
  const underwater = headUnderwater();
  underwaterSince = underwater ? (underwaterSince ?? Date.now()) : null;
  const longUnderwater = underwaterSince !== null && Date.now() - underwaterSince > MAX_UNDERWATER_MS;

  // Idle in deep water: tread water instead of sinking (the pathfinder
  // swims on its own while it's walking somewhere)
  const shouldFloat = !active && !bot.vehicle && isWaterAt(0.2) && !pathing.isMoving();
  if (shouldFloat !== floating) {
    floating = shouldFloat;
    setControl("jump", shouldFloat);
  }

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
  // Swim up: jump is "swim up" in water; looking up and pushing forward
  // slides the bot out from under overhangs and onto the shore
  // (never off a drop: only up, there)
  void lookToward(bot.entity.yaw, Math.PI / 4);
  setControl("jump", true);
  setControl("forward", !dropAhead());
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
