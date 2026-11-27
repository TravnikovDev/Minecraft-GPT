// Gravel fallen into its head in a pokehole: dug out at once (game test: it
// suffocated for 12 seconds while the tunnel dug on, and died with 1022 items).
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { buriedHead } = await import(`${ROOT}/src/actions/suffocationReflex.ts`);

test("a block of gravel, sand or stone in its head is dug out; its door, a gate or air never", () => {
  expect(buriedHead({ name: "gravel", boundingBox: "block" })).toBe(true);
  expect(buriedHead({ name: "sand", boundingBox: "block" })).toBe(true);
  expect(buriedHead({ name: "stone", boundingBox: "block" })).toBe(true);
  expect(buriedHead({ name: "air", boundingBox: "empty" })).toBe(false);
  expect(buriedHead({ name: "oak_door", boundingBox: "block" })).toBe(false);
  expect(buriedHead({ name: "oak_fence_gate", boundingBox: "block" })).toBe(false);
  expect(buriedHead({ name: "bedrock", boundingBox: "block" })).toBe(false);
  expect(buriedHead(null)).toBe(false);
});
