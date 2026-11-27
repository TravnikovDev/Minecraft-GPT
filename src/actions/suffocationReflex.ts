// Path: src/actions/suffocationReflex.ts
// Survival reflex: a block in its head (gravel or sand fallen on it while it
// digs) is dug out at once, ahead of whatever it was doing. Game test: gravel
// fell on its head in a pokehole and it suffocated for 12 seconds while the
// tunnel dug on beside it, and it died with 1022 items on it.

import { bot, onConnectionEnd } from "../core/body";
import { isNatural } from "../core/movements";
import { asReflex, setReflexActive } from "../core/reflexes";

const CHECK_MS = 200;
// Its eyes, over its feet
const EYE_HEIGHT = 1.62;

let busy = false;

/** A block as the reflex sees it. */
export type HeadBlock = { name: string; boundingBox: string } | null;

/**
 * True when its head is inside a block that suffocates it and that it may
 * dig: a full natural block (gravel, sand, stone, dirt), never its door, a
 * gate or anything built, nor bedrock or leaves. Pure.
 */
export function buriedHead(b: HeadBlock): boolean {
  if (!b || b.boundingBox !== "block") return false;
  if (b.name === "bedrock" || b.name.endsWith("_leaves")) return false;
  return isNatural(b.name);
}

async function tick(): Promise<void> {
  if (busy || !bot.entity || !(bot.health > 0)) return;
  const head = bot.entity.position.offset(0, EYE_HEIGHT, 0).floored();
  const b = bot.blockAt(head);
  if (!buriedHead(b)) return;
  busy = true;
  setReflexActive("suffocation", true);
  try {
    console.log(`Suffocation reflex: ${b!.name} in my head at ${head}; digging it out.`);
    const { breakBlock } = await import("../core/primitives");
    // Water behind it is better than suffocating: dug anyway
    const broken = await breakBlock(head, { allowWithoutHarvest: true, intoLiquid: true });
    if (!broken.ok) console.log(`Suffocation reflex: couldn't dig the ${b!.name} out of my head (${broken.detail}).`);
  } finally {
    setReflexActive("suffocation", false);
    busy = false;
  }
}

/** Starts the reflex for the current bot instance. */
export function registerSuffocationReflex(): void {
  busy = false;
  const timer = setInterval(() => void asReflex("suffocation", tick), CHECK_MS);
  onConnectionEnd(bot, () => clearInterval(timer));
}
