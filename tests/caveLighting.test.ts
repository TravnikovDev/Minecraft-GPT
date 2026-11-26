// Lighting a cave as it goes (owner: going into a cave is fine, but light the
// cavern first). Its own one-wide tunnels get torches as they're dug; an
// open cave gets one at its feet when it's dark there.
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { isCave } = await import(`${ROOT}/src/actions/caveLighting.ts`);

test("a one-wide tunnel isn't a cave; a cavern is", () => {
  // Tunnel along x, 1 wide, 3 high
  const tunnel = (_x: number, _y: number, z: number) => z === 0;
  expect(isCave({ x: 0, y: 64, z: 0 }, tunnel)).toBe(false);
  // A 3-wide space (its hub, a wide passage) counts as open: a torch there does no harm
  const hub = (_x: number, _y: number, z: number) => Math.abs(z) <= 1;
  expect(isCave({ x: 0, y: 64, z: 0 }, hub)).toBe(true);
  // An open cavern round it
  const cavern = () => true;
  expect(isCave({ x: 0, y: 64, z: 0 }, cavern)).toBe(true);
});
