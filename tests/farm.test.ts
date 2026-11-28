// A farm of its own (owner: hunting isn't sustainable; a plot by the
// shelter with water in it). The plot must be flat grass or dirt, clear
// over it, and never on what it keeps (its shelter, its stairs).
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { plotFits, FARM_HALF, sowOrder, torchSpots, levelCost } = await import(`${ROOT}/src/skills/farm.ts`);

type Cell = { ground: boolean; clear: boolean; sky?: boolean; tree?: boolean } | null;
const flat = (groundY: number) => (_x: number, y: number): Cell => (y === groundY ? { ground: true, clear: false } : y === groundY + 1 ? { ground: false, clear: true } : { ground: false, clear: false });

test("a flat 9 x 9 of grass with air over it fits", () => {
  expect(FARM_HALF).toBe(4);
  expect(plotFits({ x: 0, y: 63, z: 0 }, flat(63))).toBe(true);
});

test("a step in the ground, a tree on it or a kept cell spoils the plot", () => {
  const stepped = (x: number, y: number, z: number): Cell => (x === 4 && z === 4 ? flat(64)(x, y) : flat(63)(x, y));
  expect(plotFits({ x: 0, y: 63, z: 0 }, stepped)).toBe(false);
  const tree = (x: number, y: number, z: number): Cell => (x === -2 && z === 1 && y === 64 ? { ground: false, clear: false } : flat(63)(x, y));
  expect(plotFits({ x: 0, y: 63, z: 0 }, tree)).toBe(false);
  const keptCell = (p: { x: number; y: number; z: number }) => p.x === 3 && p.z === -3;
  expect(plotFits({ x: 0, y: 63, z: 0 }, flat(63), keptCell)).toBe(false);
});

test("in the shade of trees or right beside one, no farm (game test: squeezed between oaks)", () => {
  const shaded = (x: number, y: number, z: number): Cell => (x === 1 && z === 1 && y === 63 ? { ground: true, clear: false, sky: false } : flat(63)(x, y));
  expect(plotFits({ x: 0, y: 63, z: 0 }, shaded)).toBe(false);
  const trunkBeside = (x: number, y: number, z: number): Cell => (x === 5 && z === 2 && y === 64 ? { ground: false, clear: false, tree: true } : flat(63)(x, y));
  expect(plotFits({ x: 0, y: 63, z: 0 }, trunkBeside)).toBe(false);
});

test("sown from the water outward: a few seeds make a patch round it, not a strip at the edge", () => {
  const order = sowOrder({ x: 0, y: 63, z: 0 });
  expect(order.length).toBe(80);
  expect(order.slice(0, 8).every((p: { x: number; z: number }) => Math.max(Math.abs(p.x), Math.abs(p.z)) === 1)).toBe(true);
  expect(order.some((p: { x: number; z: number }) => p.x === 0 && p.z === 0)).toBe(false);
});

test("four torches by the sides light every cell to 9 or more (crops grow at night)", () => {
  const torches = torchSpots({ x: 0, y: 63, z: 0 });
  for (let x = -FARM_HALF; x <= FARM_HALF; x++)
    for (let z = -FARM_HALF; z <= FARM_HALF; z++) {
      const light = Math.max(...torches.map((t: { x: number; z: number }) => 14 - Math.abs(t.x - x) - Math.abs(t.z - z)));
      expect(light).toBeGreaterThanOrEqual(9);
    }
});

test("fields: four to live on (owner: bigger fields, bread); snow on the plot is cleared like grass (owner)", async () => {
  const { FIELDS_WANTED, plotFits } = await import(`${ROOT}/src/skills/farm.ts`);
  expect(FIELDS_WANTED).toBe(4); // owner: bigger fields and bread
  // A snow layer over the grass: the plot still fits (the snow counts as clear in the live view)
  expect(plotFits({ x: 0, y: 63, z: 0 }, flat(63))).toBe(true);
});

test("a smaller field where a 9 by 9 doesn't fit: 7 by 7, then 5 by 5 (game test: snowy hills)", async () => {
  const { FIELD_HALVES, plotFits, sowOrder, torchSpots } = await import(`${ROOT}/src/skills/farm.ts`);
  expect(FIELD_HALVES).toEqual([4, 3, 2]);
  // Flat only 5 wide round the middle: no 9x9, a 5x5 fits
  const narrow = (x: number, y: number, z: number): Cell => (Math.max(Math.abs(x), Math.abs(z)) <= 3 ? flat(63)(x, y) : flat(64)(x, y));
  expect(plotFits({ x: 0, y: 63, z: 0 }, narrow, () => false, 4)).toBe(false);
  expect(plotFits({ x: 0, y: 63, z: 0 }, narrow, () => false, 2)).toBe(true);
  expect(sowOrder({ x: 0, y: 63, z: 0 }, 2).length).toBe(24);
  expect(torchSpots({ x: 0, y: 63, z: 0 }, 2)[0]).toEqual({ x: 3, y: 64, z: 0 });
});

test("a field starts 5 by 5 in ground kept for 9 by 9 and grows a ring once it's all sown (owner)", async () => {
  const { FIRST_HALF, nextHalf } = await import(`${ROOT}/src/skills/farm.ts`);
  expect(FIRST_HALF).toBe(2);
  expect(nextHalf(2, 4, 0)).toBe(3); // all sown: 7x7
  expect(nextHalf(2, 4, 6)).toBe(2); // bare cells left: not yet
  expect(nextHalf(3, 4, 0)).toBe(4); // then 9x9
  expect(nextHalf(4, 4, 0)).toBe(4); // as big as its ground
  expect(nextHalf(2, 2, 0)).toBe(2); // only 5x5 of ground kept
});

test("levelling a plot by home: bumps, stone and dips cost a block each; a tree or a hill rules it out (owner)", () => {
  type L = { name: string; solid: boolean } | null;
  const ground = (y0: number) => (_x: number, y: number): L => (y <= y0 ? { name: y === y0 ? "grass_block" : "dirt", solid: true } : { name: "air", solid: false });
  // Flat grass: nothing to do
  expect(levelCost({ x: 0, y: 63, z: 0 }, 2, ground(63))).toBe(0);
  // One block of stone sticking up: 1 to dig out
  const bump = (x: number, y: number, z: number): L => (x === 1 && z === 1 && y === 64 ? { name: "stone", solid: true } : ground(63)(x, y));
  expect(levelCost({ x: 0, y: 63, z: 0 }, 2, bump)).toBe(1);
  // A one-deep dip: the ground cell filled
  const dip = (x: number, y: number, z: number): L => (x === 0 && z === 2 && y === 63 ? { name: "air", solid: false } : ground(63)(x, y));
  expect(levelCost({ x: 0, y: 63, z: 0 }, 2, dip)).toBe(1);
  // A tree trunk on it, or a 5-high hill: not here
  const tree = (x: number, y: number, z: number): L => (x === -1 && z === 0 && y === 64 ? { name: "oak_log", solid: true } : ground(63)(x, y));
  expect(levelCost({ x: 0, y: 63, z: 0 }, 2, tree)).toBeNull();
  const hill = (x: number, y: number, z: number): L => (x === 2 && z === -2 && y <= 68 ? { name: "stone", solid: true } : ground(63)(x, y));
  expect(levelCost({ x: 0, y: 63, z: 0 }, 2, hill)).toBeNull();
});

test("the flat surface is the whole field and its fence ring; its own farmland, fence and water stay (owner)", async () => {
  const { columnWork } = await import(`${ROOT}/src/skills/farm.ts`);
  type L = { name: string; solid: boolean } | null;
  const mid = { x: 0, y: 63, z: 0 };
  const ground = (y0: number, top = "grass_block") => (_x: number, y: number): L => (y <= y0 ? { name: y === y0 ? top : "dirt", solid: true } : { name: "air", solid: false });
  // Fresh farmland is level ground, never broken and put back as dirt (game test)
  expect(levelCost(mid, 3, ground(63, "farmland"), () => false, 2)).toBe(0);
  // A dip in the fence ring (ring 3 of a 5x5 kept) counts: the fence stands on flat ground
  const ringDip = (x: number, y: number, z: number): L => (x === 3 && z === 0 && y === 63 ? { name: "air", solid: false } : ground(63)(x, y));
  expect(levelCost(mid, 3, ringDip, () => false, 2)).toBe(1);
  // Stone in the ring is fine ground for a post; stone in the sown part is swapped
  const stoneAt = (sx: number) => (x: number, y: number, z: number): L => (x === sx && z === 0 && y === 63 ? { name: "stone", solid: true } : ground(63)(x, y));
  expect(levelCost(mid, 3, stoneAt(3), () => false, 2)).toBe(0);
  expect(levelCost(mid, 3, stoneAt(1), () => false, 2)).toBe(1);
  // Its fence post on the ring isn't a bump to dig out
  const post = (x: number, y: number, z: number): L => (x === 3 && z === 1 && y === 64 ? { name: "oak_fence", solid: true } : ground(63)(x, y));
  expect(columnWork(mid, 3, 1, 2, post)).toEqual({ x: 3, z: 1, bumps: [], swap: false, fill: 0 });
  // A post left a block too high (over a bump since dug out), or sunk in a dip: taken down and set level
  const high = (x: number, y: number, z: number): L => (x === 3 && z === 1 && y === 65 ? { name: "oak_fence", solid: true } : ground(63)(x, y));
  expect(columnWork(mid, 3, 1, 2, high)).toEqual({ x: 3, z: 1, bumps: [2], swap: false, fill: 0 });
  const sunk = (x: number, y: number, z: number): L => (x === 3 && z === 1 && y === 63 ? { name: "oak_fence", solid: true } : ground(63)(x, y));
  expect(columnWork(mid, 3, 1, 2, sunk)).toEqual({ x: 3, z: 1, bumps: [], swap: true, fill: 0 });
  // A post inside the sown part: taken down
  const inside = (x: number, y: number, z: number): L => (x === 1 && z === 1 && y === 64 ? { name: "oak_fence", solid: true } : ground(63)(x, y));
  expect(columnWork(mid, 1, 1, 2, inside)?.bumps).toEqual([1]);
  // The middle's water stays
  const water = (x: number, y: number, z: number): L => (x === 0 && z === 0 && y === 63 ? { name: "water", solid: false } : ground(63)(x, y));
  expect(levelCost(mid, 3, water, () => false, 2)).toBe(0);
  // A creeper's crater 5 deep: past what a new field takes on, but mended when tended
  const crater = (x: number, y: number, z: number): L => (x === 1 && z === 1 && y > 58 ? { name: "air", solid: false } : ground(63)(x, y));
  expect(columnWork(mid, 1, 1, 2, crater)).toBeNull();
  expect(columnWork(mid, 1, 1, 2, crater, 6)).toEqual({ x: 1, z: 1, bumps: [], swap: false, fill: 5 });
});

test("a fence all round the field's ground, a gate on the side facing home (owner)", async () => {
  const { fenceRing } = await import(`${ROOT}/src/skills/farm.ts`);
  const { posts, gate } = fenceRing({ x: 0, y: 63, z: 0 }, 3, { x: 20, z: 2 });
  // Ring 4 out: 8 * 4 cells, less the gate
  expect(posts.length).toBe(8 * 4 - 1);
  expect(gate).toEqual({ x: 4, z: 0 }); // home is east
  expect(posts.every((p: { x: number; z: number }) => Math.max(Math.abs(p.x), Math.abs(p.z)) === 4)).toBe(true);
  expect(fenceRing({ x: 0, y: 63, z: 0 }, 2, { x: 1, z: -30 }).gate).toEqual({ x: 0, z: -3 }); // home is north
});

test("the path round a field's fence: banks and tall grass above the field dug out, built things and a neighbour's fence left, dips kept (owner: the bank outside stood as high as the fence)", async () => {
  const { columnWork } = await import(`${ROOT}/src/skills/farm.ts`);
  const middle = { x: 0, y: 63, z: 0 };
  // Planted up to ring 3: the fence on ring 4, the path on ring 5
  const world = (above: Record<number, { name: string; solid: boolean }>) => (_x: number, y: number) => above[y - 63] ?? (y <= 63 ? { name: "dirt", solid: true } : { name: "air", solid: false });
  // A grass bank two high with tall grass on it, on the path
  const bank = world({ 1: { name: "dirt", solid: true }, 2: { name: "grass_block", solid: true }, 3: { name: "tall_grass", solid: false } });
  expect(columnWork(middle, 5, 0, 3, bank)?.bumps).toEqual([1, 2, 3]);
  // The owner's wall there: left alone
  expect(columnWork(middle, 5, 0, 3, world({ 1: { name: "stone_bricks", solid: true } }))?.bumps).toEqual([]);
  // A neighbour field's fence on the path: left standing
  expect(columnWork(middle, 5, 0, 3, world({ 1: { name: "oak_fence", solid: true } }))?.bumps).toEqual([]);
  // A dip outside: no filling (lower ground is no way in)
  const dip = (_x: number, y: number) => (y <= 61 ? { name: "dirt", solid: true } : { name: "air", solid: false });
  expect(columnWork(middle, 5, 0, 3, dip)).toEqual({ x: 5, z: 0, bumps: [], swap: false, fill: 0 });
  // A trunk on the path: can't be cleared
  expect(columnWork(middle, 5, 0, 3, world({ 1: { name: "jungle_log", solid: true } }))).toBeNull();
});

test("a field's opening (no gate: owner) is in the middle of the side facing home", async () => {
  const { fenceRing } = await import(`${ROOT}/src/skills/farm.ts`);
  const middle = { x: 0, y: 63, z: 0 };
  const east = fenceRing(middle, 3, { x: 30, z: 2 });
  expect(east.gate).toEqual({ x: 4, z: 0 });
  expect(east.posts.some((p: any) => p.x === 4 && p.z === 0)).toBe(false); // no post in the opening
  expect(fenceRing(middle, 3, { x: 1, z: -30 }).gate).toEqual({ x: 0, z: -4 });
});

test("fields keep off the way its mine's stairs go from the shelter's back door (game test: a field's gate right above the stairs' first steps)", async () => {
  const { onMineWay } = await import(`${ROOT}/src/skills/farm.ts`);
  const way = { exit: { x: -63, z: -13 }, step: { x: 0, z: 1 } }; // the stairs go south
  expect(onMineWay({ x: -63, z: -11 }, way)).toBe(true); // that field's gate
  expect(onMineWay({ x: -61, z: 10 }, way)).toBe(true); // two across, well along
  expect(onMineWay({ x: -60, z: -5 }, way)).toBe(false); // three across: free
  expect(onMineWay({ x: -63, z: -16 }, way)).toBe(false); // behind the door (the shelter)
  expect(onMineWay({ x: -63, z: 30 }, way)).toBe(false); // past the stairs' way
  expect(onMineWay({ x: -63, z: -11 }, null)).toBe(false); // no shelter yet
});

test("a field by water: its cells within 4 of a river stay moist (owner: the field by the river grew faster)", async () => {
  const { hydratedCells } = await import(`${ROOT}/src/skills/farm.ts`);
  const middle = { x: 0, y: 64, z: 0 };
  // No water near: none
  expect(hydratedCells(middle, 4, () => false)).toBe(0);
  // A deep river along x 6 (beyond the field's edge at 4 and its fence at 5): the 3 columns nearest it, all 9 rows
  const river = (x: number, y: number) => x >= 6 && x <= 9 && y <= 64 && y >= 60;
  expect(hydratedCells(middle, 4, (x: number, y: number) => river(x, y))).toBe(3 * 9);
  // A shallow pond in the same place: levelling fills the part in the field's area, so less of it counts
  const pond = (x: number, y: number) => x >= 6 && x <= 9 && y === 64;
  expect(hydratedCells(middle, 4, (x: number, y: number) => pond(x, y))).toBeLessThan(3 * 9);
});
