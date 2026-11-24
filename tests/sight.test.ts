// What the bot can see: ore open to air with a clear line from its eyes.
// Runs on a real prismarine world (chunks and its own raycast).
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const Chunk = require(`${ROOT}/node_modules/prismarine-chunk`)(registry);
const World = require(`${ROOT}/node_modules/prismarine-world`)(registry);
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
const { canSee, openFaces } = await import(`${ROOT}/src/actions/sight.ts`);

const state = (name: string): number => registry.blocksByName[name].defaultState;
const world = new World(null).sync;
for (let cx = 0; cx < 2; cx++) for (let cz = 0; cz < 2; cz++) world.setColumn(cx, cz, new Chunk({ minY: -64, worldHeight: 384 }));
const set = (x: number, y: number, z: number, name: string): void => world.setBlockStateId(new Vec3(x, y, z), state(name));

// Solid stone from y=50 to 70, with a cave room: x 10..20, y 60..63, z 10..20
for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) for (let y = 50; y <= 70; y++) set(x, y, z, "stone");
for (let x = 10; x <= 20; x++) for (let z = 10; z <= 20; z++) for (let y = 60; y <= 63; y++) set(x, y, z, "cave_air");

set(21, 61, 14, "iron_ore"); // in the cave wall, facing the bot
set(25, 61, 14, "iron_ore"); // buried in stone
set(12, 61, 25, "cave_air"); // a separate pocket behind 4 blocks of stone...
set(12, 61, 26, "iron_ore"); // ...with an ore open to it
set(16, 64, 18, "iron_ore"); // in the ceiling, off to the side

const eyes = new Vec3(12.5, 60 + 1.62, 12.5); // standing on the cave floor
const ore = (x: number, y: number, z: number) => world.getBlock(new Vec3(x, y, z));

test("an ore in the cave wall is open and in sight", () => {
  expect(openFaces(world, ore(21, 61, 14)).length).toBe(1);
  expect(canSee(world, eyes, ore(21, 61, 14), 48)).toBe(true);
});

test("a buried ore is not in sight (that would be x-ray)", () => {
  expect(openFaces(world, ore(25, 61, 14))).toEqual([]);
  expect(canSee(world, eyes, ore(25, 61, 14), 48)).toBe(false);
});

test("an ore open to air elsewhere, behind stone, is not in sight", () => {
  expect(openFaces(world, ore(12, 61, 26)).length).toBe(1);
  expect(canSee(world, eyes, ore(12, 61, 26), 48)).toBe(false);
});

test("a ceiling ore seen at an angle counts, though a ray to its centre hits the stone beside it", () => {
  const ceiling = ore(16, 64, 18);
  const centre = ceiling.position.offset(0.5, 0.5, 0.5).minus(eyes);
  const range = centre.norm(); // before normalize(), which changes the vector in place
  const centreHit = world.raycast(eyes, centre.normalize(), range);
  expect(centreHit.position.equals(ceiling.position)).toBe(false); // mineflayer's canSeeBlock says "hidden"
  expect(canSee(world, eyes, ceiling, 48)).toBe(true);
});

test("too far away is not in sight", () => {
  expect(canSee(world, eyes, ore(21, 61, 14), 5)).toBe(false);
});
