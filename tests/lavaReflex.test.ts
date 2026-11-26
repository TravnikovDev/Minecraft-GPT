// The lava reflex's way out. Game test: a walk dropped the bot into lava at
// y=-53 and it stood there until it died; it now heads for the nearest ground
// with no lava around it, by ways a body in lava can really take.
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { wayOutOfLava, findWay, safeFromLava, touchingCells } = await import(`${ROOT}/src/actions/lavaReflex.ts`);

type Cell = { lava: boolean; open: boolean; solid: boolean; water?: boolean } | null;
const LAVA: Cell = { lava: true, open: false, solid: false };
const AIR: Cell = { lava: false, open: true, solid: false };
const STONE: Cell = { lava: false, open: false, solid: true };
const WATER: Cell = { lava: false, open: false, solid: false, water: true };
type P = { x: number; y: number; z: number };

/** A world from a map of "x,y,z" to cells; everything else is `rest` (or a stone floor under air). */
const world = (cells: Record<string, Cell>, rest?: Cell) => (x: number, y: number, z: number): Cell => {
  const k = `${x},${y},${z}`;
  if (k in cells) return cells[k]!;
  if (rest !== undefined) return rest;
  return y < 0 ? STONE : AIR;
};

test("in a lava pool: out to the nearest ground with no lava around it", () => {
  // Lava at x=0..1 (feet level, the floor under it is lava too); dry floor from x=2 on
  const cells: Record<string, Cell> = { "0,0,0": LAVA, "1,0,0": LAVA, "0,-1,0": LAVA, "1,-1,0": LAVA };
  const look = world(cells);
  const path = wayOutOfLava({ x: 0, y: 0, z: 0 }, look);
  expect(path).not.toBeNull();
  const end = path!.at(-1)!;
  expect(safeFromLava(end, look)).toBe(true);
  expect(cells[`${end.x},${end.y},${end.z}`]).toBeUndefined();
});

test("standing next to lava on dry ground: steps away from it", () => {
  const cells: Record<string, Cell> = { "1,0,0": LAVA };
  const path = wayOutOfLava({ x: 0, y: 0, z: 0 }, world(cells));
  expect(path).not.toBeNull();
  expect(path!.length).toBeGreaterThan(1); // the start has lava beside it: it moves
});

test("walled in by stone: no way (it can't swim through stone)", () => {
  const look = (x: number, y: number, z: number): Cell => (x === 0 && z === 0 && (y === 0 || y === 1) ? LAVA : STONE);
  expect(wayOutOfLava({ x: 0, y: 0, z: 0 }, look, 100)).toBeNull();
});

test("magma is no ground to stand on", () => {
  const MAGMA = { lava: false, open: false, solid: true, hot: true };
  const cells: Record<string, Cell> = { "0,0,0": LAVA, "0,-1,0": LAVA, "1,-1,0": MAGMA, "-1,-1,0": MAGMA, "0,-1,1": MAGMA, "0,-1,-1": MAGMA };
  const path = wayOutOfLava({ x: 0, y: 0, z: 0 }, world(cells));
  const end = path!.at(-1)!;
  expect(cells[`${end.x},${end.y - 1},${end.z}`]).toBeUndefined(); // stands on stone
});

test("down a shaft into a lava pocket: along the pool to the corridor, never up the shaft it can't climb", () => {
  // Stone everywhere; a one-deep lava pool at y=0 from x=0 to 2 with air over
  // it; the shaft it fell down above x=0; a corridor leaving at x=3..7
  const cells: Record<string, Cell> = {};
  for (let x = 0; x <= 2; x++) {
    cells[`${x},0,0`] = LAVA;
    cells[`${x},1,0`] = AIR;
  }
  for (let y = 2; y <= 4; y++) cells[`0,${y},0`] = AIR; // the shaft
  for (let x = 3; x <= 7; x++) {
    cells[`${x},0,0`] = AIR;
    cells[`${x},1,0`] = AIR;
  }
  const look = world(cells, STONE);
  const path = wayOutOfLava({ x: 0, y: 0, z: 0 }, look) as P[] | null;
  expect(path).not.toBeNull();
  expect(path!.every((p) => p.y <= 1)).toBe(true); // never two blocks up
  const end = path!.at(-1)!;
  expect(end.y).toBe(0);
  expect(end.x).toBeGreaterThanOrEqual(4); // x=3 still has lava beside it
});

test("out of lava one block up onto a ledge (one jump), not two", () => {
  // A lava pool walled in, with a ledge one block up on the far side
  const cells: Record<string, Cell> = { "0,0,0": LAVA, "0,1,0": AIR, "0,2,0": AIR, "1,0,0": STONE, "1,1,0": AIR, "1,2,0": AIR };
  const path = wayOutOfLava({ x: 0, y: 0, z: 0 }, world(cells, STONE)) as P[] | null;
  // Up out of the lava, onto the ledge (level with the lava's top: its box doesn't reach the lava)
  expect(path).toEqual([{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }]);
  // The same ledge two blocks up is out of reach
  const high: Record<string, Cell> = { "0,0,0": LAVA, "0,1,0": AIR, "0,2,0": AIR, "0,3,0": AIR, "1,0,0": STONE, "1,1,0": STONE, "1,2,0": AIR, "1,3,0": AIR };
  expect(wayOutOfLava({ x: 0, y: 0, z: 0 }, world(high, STONE))).toBeNull();
});

test("a lava cell costs more than going around it on ground", () => {
  // From a spot on dry ground beside a pool, the dry way round beats the way across
  const cells: Record<string, Cell> = { "1,0,0": LAVA, "1,-1,0": LAVA };
  const look = world(cells);
  const across = findWay({ x: 0, y: 0, z: 0 }, look, (p: P) => p.x === 2 && p.z === 0 && p.y === 0);
  expect(across!.some((p: P) => p.x === 1 && p.z === 0)).toBe(false);
});

test("burning: the way to water close by", () => {
  const cells: Record<string, Cell> = { "3,0,0": WATER, "3,1,0": AIR };
  const look = world(cells);
  const way = findWay({ x: 0, y: 0, z: 0 }, look, (p: P) => look(p.x, p.y, p.z)?.water === true);
  expect(way?.at(-1)).toEqual({ x: 3, y: 0, z: 0 });
});

test("lava diagonally behind the rock in a corner doesn't touch it", () => {
  // Pushed into the corner of a dead-end tunnel; lava at the diagonal cell
  const lavaAt = (x: number, _y: number, z: number): boolean => x === 1 && z === 1;
  expect(touchingCells({ x: 0.7, y: 0, z: 0.7 }, lavaAt)).toEqual([]);
  // Its box does reach a cell it overlaps
  expect(touchingCells({ x: 0.75, y: 0, z: 0.5 }, (x: number) => x === 1).length).toBeGreaterThan(0);
});

test("ground with lava diagonally beside it isn't safe (its box reaches there)", () => {
  const look = world({ "1,0,1": LAVA });
  expect(safeFromLava({ x: 0, y: 0, z: 0 }, look)).toBe(false);
  expect(safeFromLava({ x: -2, y: 0, z: -2 }, look)).toBe(true);
});
