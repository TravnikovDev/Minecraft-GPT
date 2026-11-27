// Felling a tree from its top (owner: stand on the trunk and grind it down,
// no reaching up through the leaves); savanna acacia from the bottom.
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { fellFromTop } = await import(`${ROOT}/src/actions/gatherWood.ts`);

const column = (name: string, n: number, x = 0, z = 0) => Array.from({ length: n }, (_, y) => ({ name, position: { x, y: 64 + y, z } }));

test("a straight trunk of 3 or more is felled from the top", () => {
  expect(fellFromTop(column("oak_log", 5))).toBe(true);
  expect(fellFromTop(column("birch_log", 7))).toBe(true);
  expect(fellFromTop(column("spruce_log", 3))).toBe(true);
});

test("savanna acacia, wide trunks and short ones from the bottom, as before", () => {
  expect(fellFromTop(column("acacia_log", 6))).toBe(false); // crooked savanna trunk
  expect(fellFromTop([...column("dark_oak_log", 5, 0, 0), ...column("dark_oak_log", 5, 1, 0)])).toBe(false); // 2x2
  expect(fellFromTop(column("oak_log", 2))).toBe(false); // in reach from the ground
});

test("the pillar goes beside the crown, not against the trunk (owner), on free ground up past the crown's top", async () => {
  const { crownTop, pillarSpot } = await import(`${ROOT}/src/actions/gatherWood.ts`);
  // An oak: trunk at (0, 64..68, 0), leaves 2 round at y 67-68 and 1 round at 69-70; ground at y 63
  const blocks = new Map<string, string>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (let y = 64; y <= 68; y++) blocks.set(key(0, y, 0), "oak_log");
  for (let y = 67; y <= 70; y++) {
    const r = y <= 68 ? 2 : 1;
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) if (!blocks.has(key(x, y, z))) blocks.set(key(x, y, z), "oak_leaves");
  }
  const at = (p: any) => {
    const n = blocks.get(key(p.x, p.y, p.z)) ?? (p.y <= 63 ? "grass_block" : "air");
    return { name: n, boundingBox: n === "air" ? "empty" : "block" };
  };
  const top = { x: 0, y: 68, z: 0 };
  expect(crownTop(top, at)).toBe(70);
  const spot = pillarSpot(top, 71, at);
  expect(spot).not.toBeNull();
  // Outside the leaves (more than 2 out), on the ground
  expect(Math.max(Math.abs(spot.x), Math.abs(spot.z))).toBe(3);
  expect(spot.y).toBe(64);
});

test("giant 2x2 trees and jungle trees over 6 logs are left standing; acacia's crooked trunk isn't a giant", async () => {
  const { isGiant, leftStanding } = await import(`${ROOT}/src/actions/gatherWood.ts`);
  const giant = [...column("jungle_log", 20, 0, 0), ...column("jungle_log", 20, 1, 0), ...column("jungle_log", 20, 0, 1), ...column("jungle_log", 20, 1, 1)];
  expect(isGiant(giant)).toBe(true);
  expect(leftStanding(giant)).toBe(true);
  expect(leftStanding([...column("dark_oak_log", 6, 0, 0), ...column("dark_oak_log", 6, 1, 0), ...column("dark_oak_log", 6, 0, 1), ...column("dark_oak_log", 6, 1, 1)])).toBe(true);
  // Acacia: one log at its foot, then a branch off to the side
  const acacia = [...column("acacia_log", 4), { name: "acacia_log", position: { x: 1, y: 68, z: 0 } }, { name: "acacia_log", position: { x: 2, y: 69, z: 0 } }];
  expect(isGiant(acacia)).toBe(false);
  expect(leftStanding(acacia)).toBe(false);
  // One-trunk jungle trees: up to 6 logs are cut, taller ones aren't
  expect(leftStanding(column("jungle_log", 6))).toBe(false);
  expect(leftStanding(column("jungle_log", 7))).toBe(true);
  // Other tall trees are cut as before
  expect(leftStanding(column("spruce_log", 9))).toBe(false);
  expect(leftStanding(column("oak_log", 6))).toBe(false);
});
