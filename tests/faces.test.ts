// The bot put back by the server with its body exactly on a block face:
// floating point leaves it a hair inside, and physics then walks it in.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { offTheFaces } = await import(`${ROOT}/src/core/faces.ts`);

const block = (x: number, y: number, z: number) => ({ minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 });

test("put back at x = -32.3 next to the block at -32: pushed a hair west, off its face", () => {
  const pos = { x: -32.3, y: 22.2, z: 8.21 };
  expect(-32.3 + 0.3 > -32).toBe(true); // the rounding hair
  const fixed = offTheFaces(pos, [block(-32, 22, 8)]);
  expect(fixed.x + 0.3).toBeLessThanOrEqual(-32);
  expect(fixed.x).toBeGreaterThan(-32.31);
  expect(fixed.z).toBe(8.21);
});

test("at z = 32.3 below a stair step at z = 31: pushed south, off the step's face", () => {
  const fixed = offTheFaces({ x: 11.5, y: 37, z: 32.3 }, [block(11, 37, 31)]);
  expect(fixed.z - 0.3).toBeGreaterThanOrEqual(32);
  expect(fixed.x).toBe(11.5);
});

test("standing on a floor or really inside a block: left alone", () => {
  const floor = offTheFaces({ x: 3.5, y: 64, z: 3.5 }, [block(3, 63, 3)]);
  expect(floor).toEqual({ x: 3.5, z: 3.5 });
  const deep = offTheFaces({ x: 3.6, y: 64, z: 3.5 }, [block(4, 64, 3)]);
  expect(deep).toEqual({ x: 3.6, z: 3.5 });
});
