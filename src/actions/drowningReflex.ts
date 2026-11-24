// Path: src/actions/drowningReflex.ts
// Survival reflex: when the bot is underwater and running out of air, it stops
// whatever it is doing and swims straight up until it can breathe again.
// Without this the bot sinks and drowns as soon as a path fails in deep water
// (nothing holds the jump key once the pathfinder gives up).

import { bot } from "../core/body";
import { pathing } from "../core/plugins";
import { setReflexActive } from "../core/reflexes";

const CHECK_MS = 250;
const LOW_AIR = 12; // of 20; about 9 seconds of air left
const SAFE_AIR = 18;

// Blocks the bot's head can be "in water" inside of
const WATER_BLOCKS = new Set(["water", "bubble_column", "kelp", "kelp_plant", "seagrass", "tall_seagrass"]);

let active = false;

/** True while the bot is swimming up for air (other code should wait). */
export function isDrowningReflexActive(): boolean {
  return active;
}

/** Waits until the bot has its breath back. */
export async function waitForDrowningReflex(): Promise<void> {
  while (active) await new Promise((r) => setTimeout(r, 250));
}

function headUnderwater(): boolean {
  const head = bot.blockAt(bot.entity.position.offset(0, 1.62, 0));
  if (!head) return false;
  if (WATER_BLOCKS.has(head.name)) return true;
  return (head.getProperties() as { waterlogged?: boolean }).waterlogged === true;
}

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
  const air = bot.oxygenLevel ?? 20;
  const underwater = headUnderwater();

  if (!active) {
    if (!underwater || air > LOW_AIR) return;
    active = true;
    console.log(`Drowning reflex: underwater with ${air}/20 air, swimming up.`);
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
  const timer = setInterval(tick, CHECK_MS);
  bot.once("end", () => clearInterval(timer));
  bot.on("death", finish);
}
