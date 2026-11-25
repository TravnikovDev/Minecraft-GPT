// Placing a block where the bot stands has to step aside first, but only when
// its body really is in that cell: the cell next to it is fine (sealing the
// shelter from the room's first cell once walked it out of its own shelter).
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
useFakeBot({ entity: { position: new Vec3(0.5, 64, 0.5) } });
const { bodyOverlaps } = await import(`${ROOT}/src/actions/blockPlacing.ts`);

test("the cell it stands in, and the one at head height, overlap; neighbours don't", () => {
  const at = new Vec3(-24.5, 61, 35.5); // the middle of cell (-25, 61, 35)
  expect(bodyOverlaps(new Vec3(-25, 61, 35), at)).toBe(true);
  expect(bodyOverlaps(new Vec3(-25, 62, 35), at)).toBe(true);
  expect(bodyOverlaps(new Vec3(-25, 61, 36), at)).toBe(false); // the seal cell next to it
  expect(bodyOverlaps(new Vec3(-25, 63, 36), at)).toBe(false);
  expect(bodyOverlaps(new Vec3(-25, 60, 35), at)).toBe(false); // the floor
});

test("standing on the edge of a cell, its body reaches into the next one", () => {
  const edge = new Vec3(-24.1, 61, 35.5); // 0.1 from the east side
  expect(bodyOverlaps(new Vec3(-24, 61, 35), edge)).toBe(true);
});
