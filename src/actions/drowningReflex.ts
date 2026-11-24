// Path: src/actions/drowningReflex.ts
// Survival reflex: when the bot is underwater and running out of air, it stops
// whatever it is doing and swims straight up until it can breathe again.
// Without this the bot sinks and drowns as soon as a path fails in deep water
// (nothing holds the jump key once the pathfinder gives up).

import { bot } from "../core/body";
import { pathing } from "../core/plugins";
import { setReflexActive } from "../core/reflexes";

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

/** Waits until the bot has its breath back. */
export async function waitForDrowningReflex(): Promise<void> {
  while (active) await new Promise((r) => setTimeout(r, 250));
}

function isWaterAt(dy: number): boolean {
  const block = bot.blockAt(bot.entity.position.offset(0, dy, 0));
  if (!block) return false;
  if (WATER_BLOCKS.has(block.name)) return true;
  return (block.getProperties() as { waterlogged?: boolean }).waterlogged === true;
}

const headUnderwater = (): boolean => isWaterAt(1.62);

function finish(): void {
  if (!active) return;
  active = false;
  bot.setControlState("jump", false);
  bot.setControlState("forward", false);
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
    bot.setControlState("jump", shouldFloat);
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
    setReflexActive("drowning", true);
    pathing.takeOver(); // take over movement from whatever task is running
  }

  if (!underwater && air >= SAFE_AIR) {
    finish();
    return;
  }
  // Swim up: jump is "swim up" in water; looking up and pushing forward
  // slides the bot out from under overhangs and onto the shore
  void bot.look(bot.entity.yaw, Math.PI / 4, true);
  bot.setControlState("jump", true);
  bot.setControlState("forward", true);
}

/** Starts the reflex for the current bot instance. */
export function registerDrowningReflex(): void {
  active = false; // fresh state for this connection
  floating = false;
  underwaterSince = null;
  const timer = setInterval(tick, CHECK_MS);
  bot.once("end", () => clearInterval(timer));
  bot.on("death", finish);
}
