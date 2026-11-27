// A bridge over the river by its home (owner, 2026-11-27): the narrowest
// straight crossing near where it swims, bank to bank, 2 wide, at the banks'
// height, no wider than 12 blocks of water; torches at the ends and every 6.
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { planCrossing, deckCells, torchCells, MAX_SPAN } = await import(`${ROOT}/src/skills/bridge.ts`);

const GROUND = { name: "grass_block", boundingBox: "block" };
const AIR = { name: "air", boundingBox: "empty" };
const WATER = { name: "water", boundingBox: "empty" };
const STONE = { name: "stone", boundingBox: "block" };

/**
 * A river running north-south (along z): water from x = 10 to x = 10 + width - 1
 * at y 62 (one block deep over stone), grass banks with their tops at y 62 either side
 * (`bankY` for the far one). `narrow`: at z = 5 the river is only `narrowWidth` wide.
 */
function river(width: number, opts: { bankY?: number; narrowAt?: number; narrowWidth?: number } = {}) {
  return (p: { x: number; y: number; z: number }) => {
    const w = opts.narrowAt !== undefined && p.z === opts.narrowAt ? opts.narrowWidth! : width;
    const inRiver = p.x >= 10 && p.x < 10 + w;
    const farBank = p.x >= 10 + w;
    const top = farBank ? (opts.bankY ?? 62) : 62;
    if (inRiver) return p.y === 62 ? WATER : p.y < 62 ? STONE : AIR;
    return p.y <= top ? GROUND : AIR;
  };
}

test("a crossing over a 5-wide river: east-west, deck at the banks' height, 2 wide over the water", () => {
  const plan = planCrossing({ x: 12, y: 63, z: 0 }, river(5));
  expect(plan).not.toBeNull();
  expect(plan!.span).toBe(5);
  expect(Math.abs(plan!.step.dx)).toBe(1);
  expect(plan!.step.dz).toBe(0);
  expect(plan!.start.y).toBe(62);
  const cells = deckCells(plan!);
  expect(cells.length).toBe(10);
  // Every deck cell is over the river, and the two columns are side by side
  for (const c of cells) expect(c.x >= 10 && c.x < 15).toBe(true);
  expect(Math.abs(cells[0].z - cells[1].z)).toBe(1);
});

test("the narrowest place near where it swims is chosen", () => {
  // 8 wide, but only 3 wide at z = 5: the bridge goes there (its second column over the water beside it)
  const plan = planCrossing({ x: 12, y: 63, z: 0 }, river(8, { narrowAt: 5, narrowWidth: 3 }));
  expect(plan!.span).toBe(3);
  expect(plan!.start.z).toBe(5);
  // Out of reach of the search (12 blocks round where it swims): the wide crossing
  expect(planCrossing({ x: 12, y: 63, z: -20 }, river(8, { narrowAt: 5, narrowWidth: 3 }))!.span).toBe(8);
});

test("too wide (over 12 blocks of water) or a far bank 2 blocks higher: no bridge", () => {
  expect(MAX_SPAN).toBe(12);
  expect(planCrossing({ x: 12, y: 63, z: 0 }, river(12))!.span).toBe(12);
  expect(planCrossing({ x: 12, y: 63, z: 0 }, river(13))).toBeNull();
  expect(planCrossing({ x: 12, y: 63, z: 0 }, river(5, { bankY: 64 }))).toBeNull();
  // A bank one higher is fine: the deck stays at the lower bank's height
  expect(planCrossing({ x: 12, y: 63, z: 0 }, river(5, { bankY: 63 }))!.start.y).toBe(62);
});

test("torches on the outer column: both ends and every 6 blocks", () => {
  const plan = { start: { x: 10, y: 62, z: 0 }, step: { dx: 1, dz: 0 }, side: { dx: 0, dz: 1 }, span: 12 };
  const t = torchCells(plan);
  expect(t.map((c: any) => c.x)).toEqual([10, 16, 21]);
  for (const c of t) {
    expect(c.z).toBe(1);
    expect(c.y).toBe(63);
  }
  expect(torchCells({ ...plan, span: 3 }).map((c: any) => c.x)).toEqual([10, 12]);
});
