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
