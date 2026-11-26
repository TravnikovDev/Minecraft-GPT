// Path: src/actions/caveLighting.ts
// Lighting a cave as it goes, like a player (owner: going into a cave is
// fine, but light the cavern first, that's the safety measure; it went into
// a dark cave after ore and the owner had to light it for it). Mobs spawn
// only in the dark: underground, in an open cave (not its own narrow tunnels,
// which get a torch every few blocks as they're dug), with no torch near,
// it puts one down at its feet between the task's actions.

import { Vec3 } from "vec3";
import type { Block } from "prismarine-block";
import { bot } from "../core/body";
import { borrow, type Holder } from "../core/leases";
import { underRoof } from "./placement";

// No torch within this many blocks: dark here
const TORCH_NEAR = 7;
// Open cells in the 7 x 3 x 7 box round its feet that make it a cave (a
// one-wide tunnel 7 long and 3 high has 21)
const CAVE_OPEN_CELLS = 40;
const holder: Holder = { name: "lighting the way", bucket: 4 };
let busy = false;

/**
 * True when the space round `feet` is a cave: more than `threshold` open
 * cells in the 7 x 3 x 7 box. Pure over `open`.
 */
export function isCave(feet: { x: number; y: number; z: number }, open: (x: number, y: number, z: number) => boolean, threshold = CAVE_OPEN_CELLS): boolean {
  let n = 0;
  for (let dx = -3; dx <= 3; dx++)
    for (let dy = 0; dy <= 2; dy++)
      for (let dz = -3; dz <= 3; dz++) if (open(feet.x + dx, feet.y + dy, feet.z + dz)) n++;
  return n > threshold;
}

/** Called every few seconds: in a dark cave with a torch to spare, puts one down at its feet. */
export async function lightTheWay(): Promise<void> {
  if (busy || !bot.entity || !(bot.health > 0) || bot.vehicle) return;
  if (!bot.inventory.items().some((i) => i.name === "torch")) return;
  const feet = bot.entity.position.floored();
  const blockAt = (p: Vec3): Block | null => bot.blockAt(p);
  if (!underRoof(feet, blockAt)) return;
  const open = (x: number, y: number, z: number): boolean => {
    const b = bot.blockAt(new Vec3(x, y, z));
    return b !== null && (b.name === "air" || b.name === "cave_air");
  };
  if (!isCave(feet, open)) return;
  const ids = ["torch", "wall_torch"].map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  if (bot.findBlocks({ matching: ids, maxDistance: TORCH_NEAR, count: 1 }).length > 0) return;
  // On solid ground, in an open cell (it stands in it: a torch goes where the bot is)
  const below = blockAt(feet.offset(0, -1, 0));
  if (!below || below.boundingBox !== "block" || !open(feet.x, feet.y, feet.z)) return;
  busy = true;
  try {
    // Between the task's actions (the hands only: it can keep walking)
    await borrow(holder, ["hands"], async () => {
      const { placeBlockResult } = await import("./blockPlacing");
      const placed = await placeBlockResult("torch", feet.x, feet.y, feet.z, "bottom");
      if (placed.ok) console.log(`Lit the cave at ${feet}.`);
    }, 5_000);
  } finally {
    busy = false;
  }
}
