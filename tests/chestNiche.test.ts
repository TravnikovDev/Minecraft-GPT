// In a tunnel the bot puts a chest in a niche dug into the side wall (2 high,
// so the chest can open), never in the way ahead and never next to water.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const Block = require(`${ROOT}/node_modules/prismarine-block`)(registry);
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
useFakeBot({ registry, version: "1.20.4" });
const { nicheSpot, underRoof } = await import(`${ROOT}/src/actions/placement.ts`);

const key = (p: any) => `${p.x},${p.y},${p.z}`;
/** Solid stone everywhere except a 1-wide, 3-high tunnel running north from z=0 at y=10..12. */
function tunnel(extra: Record<string, string> = {}) {
  return (p: any) => {
    const inTunnel = p.x === 0 && p.z <= 0 && p.z >= -10 && p.y >= 10 && p.y <= 12;
    const name = extra[key(p)] ?? (inTunnel ? "air" : "stone");
    const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
    b.position = new Vec3(p.x, p.y, p.z);
    return b;
  };
}
const feet = new Vec3(0, 10, -5);

test("in a tunnel the chest goes into a side wall, not across the tunnel", () => {
  const blockAt = tunnel();
  expect(underRoof(feet, blockAt)).toBe(true);
  const spot = nicheSpot(feet, blockAt);
  expect(spot).not.toBeNull();
  expect(spot.z).toBe(-5); // beside the bot, east or west
  expect(Math.abs(spot.x)).toBe(1);
});

test("no niche next to water", () => {
  const blockAt = tunnel({ "2,10,-5": "water", "-1,12,-5": "water" });
  expect(nicheSpot(feet, blockAt)).toBeNull();
});

test("at the dead end of a tunnel, a side wall still comes first", () => {
  const end = new Vec3(0, 10, -10);
  const spot = nicheSpot(end, tunnel());
  expect(spot.z).toBe(-10);
});
