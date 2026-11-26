// The lava reflex's way out. Game test: a walk dropped the bot into lava at
// y=-53 and it stood there until it died; it now heads for the nearest ground
// with no lava beside it.
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { wayOutOfLava } = await import(`${ROOT}/src/actions/lavaReflex.ts`);

type Cell = { lava: boolean; open: boolean; solid: boolean } | null;
const LAVA: Cell = { lava: true, open: false, solid: false };
const AIR: Cell = { lava: false, open: true, solid: false };
const STONE: Cell = { lava: false, open: false, solid: true };

/** A flat floor of stone at y=-1, air above, with these cells overridden. */
const world = (cells: Record<string, Cell>) => (x: number, y: number, z: number): Cell => {
  const k = `${x},${y},${z}`;
  if (k in cells) return cells[k]!;
  return y < 0 ? STONE : AIR;
};

test("in a lava pool: out to the nearest ground with no lava beside it", () => {
  // Lava at x=0..1 (feet level, the floor under it is lava too); dry floor from x=2 on
  const cells: Record<string, Cell> = { "0,0,0": LAVA, "1,0,0": LAVA, "0,-1,0": LAVA, "1,-1,0": LAVA };
  const path = wayOutOfLava({ x: 0, y: 0, z: 0 }, world(cells));
  expect(path).not.toBeNull();
  const end = path!.at(-1)!;
  // Not right beside the lava (x=2 touches x=1's lava): one more step out
  expect(Math.abs(end.x) + Math.abs(end.z)).toBeGreaterThanOrEqual(2);
  expect(cells[`${end.x},${end.y},${end.z}`]).toBeUndefined();
});

test("standing next to lava on dry ground: steps away from it", () => {
  const cells: Record<string, Cell> = { "1,0,0": LAVA };
  const path = wayOutOfLava({ x: 0, y: 0, z: 0 }, world(cells));
  expect(path).not.toBeNull();
  expect(path!.length).toBeGreaterThan(1); // the start touches lava: it moves
  const end = path!.at(-1)!;
  expect(end).not.toEqual({ x: 0, y: 0, z: 0 });
});

test("walled in by stone: no way (it can't swim through stone)", () => {
  const look = (x: number, y: number, z: number): Cell => (x === 0 && z === 0 && (y === 0 || y === 1) ? LAVA : STONE);
  expect(wayOutOfLava({ x: 0, y: 0, z: 0 }, look, 100)).toBeNull();
});

test("magma is no ground to stand on", () => {
  const MAGMA: Cell = { lava: false, open: false, solid: false };
  // Lava at the start; magma floor right beside; stone further on
  const cells: Record<string, Cell> = { "0,0,0": LAVA, "0,-1,0": LAVA, "1,-1,0": MAGMA, "-1,-1,0": MAGMA, "0,-1,1": MAGMA, "0,-1,-1": MAGMA };
  const path = wayOutOfLava({ x: 0, y: 0, z: 0 }, world(cells));
  const end = path!.at(-1)!;
  expect(cells[`${end.x},${end.y - 1},${end.z}`]).toBeUndefined(); // stands on stone
});
