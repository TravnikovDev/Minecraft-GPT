// Path: src/skills/endgame/geometry.ts
// The geometry of the late game (Phase 9), pure and tested without a game:
// the Nether portal's frame, where two eyes of ender cross (the stronghold),
// and safe ground on the End island.

export type P3 = { x: number; y: number; z: number };
export type Axis = "x" | "z";

const add = (a: P3, b: P3): P3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const along = (axis: Axis, n: number): P3 => (axis === "x" ? { x: n, y: 0, z: 0 } : { x: 0, y: 0, z: n });
const up = (n: number): P3 => ({ x: 0, y: n, z: 0 });

/**
 * The smallest Nether portal (2 wide, 3 tall inside) with its bottom-left
 * inside cell at `inner`: the 10 obsidian of its frame (no corners needed)
 * and the 6 cells inside it, which must be air to light it. Pure.
 */
export function portalFrame(inner: P3, axis: Axis): { frame: P3[]; inside: P3[] } {
  const frame: P3[] = [];
  const inside: P3[] = [];
  for (let i = 0; i < 2; i++) {
    frame.push(add(add(inner, along(axis, i)), up(-1))); // bottom
    frame.push(add(add(inner, along(axis, i)), up(3))); // top
    for (let j = 0; j < 3; j++) inside.push(add(add(inner, along(axis, i)), up(j)));
  }
  for (let j = 0; j < 3; j++) {
    frame.push(add(add(inner, along(axis, -1)), up(j))); // left side
    frame.push(add(add(inner, along(axis, 2)), up(j))); // right side
  }
  return { frame, inside };
}

/**
 * Where two eyes of ender cross: each eye flew from where it was thrown (p)
 * in a direction (d) on the ground plane. Null when the lines are about
 * parallel (throw again from further to the side) or cross behind a
 * thrower. Pure.
 */
export function triangulate(p1: { x: number; z: number }, d1: { x: number; z: number }, p2: { x: number; z: number }, d2: { x: number; z: number }): { x: number; z: number } | null {
  const cross = d1.x * d2.z - d1.z * d2.x;
  const n1 = Math.hypot(d1.x, d1.z);
  const n2 = Math.hypot(d2.x, d2.z);
  // Under 1 degree apart: too flat to trust (an eye flies straight at its
  // target and its position comes at 1/4096 of a block, so 1 degree is
  // plenty; 5 rejected every stronghold past about 2,300 blocks)
  if (n1 === 0 || n2 === 0 || Math.abs(cross) / (n1 * n2) < Math.sin((1 * Math.PI) / 180)) return null;
  const dx = p2.x - p1.x;
  const dz = p2.z - p1.z;
  const t = (dx * d2.z - dz * d2.x) / cross;
  const s = (dx * d1.z - dz * d1.x) / cross;
  if (t <= 0 || s <= 0) return null;
  return { x: p1.x + t * d1.x, z: p1.z + t * d1.z };
}

/**
 * Where to throw the second eye from: `distance` blocks off to the side of
 * the first eye's line (a right angle gives the sharpest crossing). Pure.
 */
export function secondThrowSpot(p1: { x: number; z: number }, d1: { x: number; z: number }, distance = 120): { x: number; z: number } {
  const n = Math.hypot(d1.x, d1.z) || 1;
  return { x: p1.x - (d1.z / n) * distance, z: p1.z + (d1.x / n) * distance };
}

// The End island: the main island is about 75 blocks across around 0, 0;
// past this from the centre, or off its ground, is the void
const ISLAND_RADIUS = 60;

/**
 * True when a spot on the End island is safe to stand on: near the centre
 * and with end stone, obsidian or bedrock right under it (never the edge,
 * never the void). `below` is the block under the spot. Pure.
 */
export function safeOnIsland(spot: { x: number; z: number }, below: string | null): boolean {
  if (Math.hypot(spot.x, spot.z) > ISLAND_RADIUS) return false;
  return below === "end_stone" || below === "obsidian" || below === "bedrock";
}

/** How many eyes of ender a stronghold run needs: 12 frames at most, plus spares for throws that break. Pure. */
export function eyesNeeded(framesFilled = 0, throws = 4): number {
  return Math.max(0, 12 - framesFilled) + throws;
}
