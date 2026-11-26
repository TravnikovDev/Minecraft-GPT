// A lit home (owner: mobs kept coming at the shelter because nothing round
// it was lit). Hostile mobs spawn only at block light 0; a grid of torches
// on the ground round the shelter keeps them from spawning there.
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { torchGrid, torchNear, groundSpot, LIGHT_RADIUS, LIGHT_SPACING } = await import(`${ROOT}/src/skills/lighting.ts`);

test("the torch grid covers the ground round the home with no spot dark", () => {
  const grid = torchGrid({ x: 0, z: 0 });
  expect(grid.length).toBe(25); // 5 x 5, 7 apart, out to 14
  // Every cell within the radius is within light reach of a grid torch
  // (torch light 14, one less per block: light over 0 within 13 blocks' walk)
  for (let x = -LIGHT_RADIUS; x <= LIGHT_RADIUS; x++) {
    for (let z = -LIGHT_RADIUS; z <= LIGHT_RADIUS; z++) {
      const nearest = Math.min(...grid.map((g: { x: number; z: number }) => Math.abs(g.x - x) + Math.abs(g.z - z)));
      expect(nearest).toBeLessThanOrEqual(LIGHT_SPACING);
    }
  }
});

test("a torch already close counts; one far off or on another floor doesn't", () => {
  const p = { x: 0, y: 64, z: 0 };
  expect(torchNear(p, [{ x: 3, y: 64, z: 2 }])).toBe(true);
  expect(torchNear(p, [{ x: 6, y: 64, z: 0 }])).toBe(false);
  expect(torchNear(p, [{ x: 1, y: 50, z: 0 }])).toBe(false); // in the mine below
});

test("the torch goes on the ground: the open cell over solid ground nearest the home's level", () => {
  // Ground at y=62 here (the home's stairs top is at 64)
  const look = (_x: number, y: number) => (y <= 62 ? { open: false, ground: true } : { open: true, ground: false });
  expect(groundSpot(5, 5, 64, look)).toEqual({ x: 5, y: 63, z: 5 });
  // Water or a tree's leaves all the way: no spot
  const wet = () => ({ open: false, ground: false });
  expect(groundSpot(5, 5, 64, wet)).toBeNull();
  // Not loaded: no spot
  expect(groundSpot(5, 5, 64, () => null)).toBeNull();
});

test("the lit ground in three grades: each wider, the third sparser, all centred on the home", async () => {
  const { LIGHT_GRADES } = await import(`${ROOT}/src/skills/lighting.ts`);
  const [one, two, three] = LIGHT_GRADES;
  expect(two.radius).toBe(one.radius * 2);
  expect(three.radius).toBe(one.radius * 3);
  expect(three.spacing).toBeGreaterThan(one.spacing);
  // The first grade's spots are all in the second's grid (no torches doubled up)
  const g1 = torchGrid({ x: 0, z: 0 }, one.radius, one.spacing).map((p: { x: number; z: number }) => `${p.x},${p.z}`);
  const g2 = new Set(torchGrid({ x: 0, z: 0 }, two.radius, two.spacing).map((p: { x: number; z: number }) => `${p.x},${p.z}`));
  expect(g1.every((k: string) => g2.has(k))).toBe(true);
  // The third grade still lights its whole square: every cell within the
  // radius is at most 12 blocks' walk from a torch (light over 0 out to 13)
  const g3 = torchGrid({ x: 0, z: 0 }, three.radius, three.spacing);
  for (let x = -three.radius; x <= three.radius; x += 3)
    for (let z = -three.radius; z <= three.radius; z += 3) {
      const nearest = Math.min(...g3.map((p: { x: number; z: number }) => Math.abs(p.x - x) + Math.abs(p.z - z)));
      expect(nearest).toBeLessThanOrEqual(13);
    }
});
