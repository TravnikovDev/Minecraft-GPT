// The bot knows about every animal the server reports within 200 blocks, seen
// or not (a sheep behind a hill still says "baa"); the hunt walks toward the
// ones out of sight. Nothing past 200 counts.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");

const animal = (id: number, name: string, x: number) => ({ id, name, position: new Vec3(x, 64, 0), metadata: [] });
const me = { position: new Vec3(0, 64, 0) };
// A chicken in a cave at x 60: rock over it (y 70 and up); open sky everywhere else
const caveChicken = { id: 5, name: "chicken", position: new Vec3(60, 20, 0), metadata: [] };
useFakeBot({
  registry,
  entity: me,
  entities: { 0: me, 1: animal(1, "sheep", 35), 2: animal(2, "cow", 150), 3: animal(3, "pig", 250), 4: animal(4, "zombie", 10), 5: caveChicken },
  blockAt: (p: { x: number; y: number }) => (p.x === 60 && p.y >= 30 ? { name: "stone", boundingBox: "block" } : null),
});
const { knownAnimals } = await import(`${ROOT}/src/actions/hunting.ts`);

test("animals within 200 blocks are known, nearest first; farther ones, monsters and ones in a cave aren't", () => {
  const known = knownAnimals().map((p: any) => `${p.name} ${Math.round(p.distance)}`);
  expect(known).toEqual(["sheep 35", "cow 150"]);
});
