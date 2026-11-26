// Path: tests/reinforce.test.ts
// A stone shelter (owner): the weak blocks of its shell are the ones stone replaces.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { weakCells } = await import(`${ROOT}/src/skills/reinforce.ts`);

test("dirt, sand and planks are weak; stone, cobblestone and open cells aren't", () => {
  const cells = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
  const world: Record<number, { name: string; solid: boolean; resistance: number } | null> = {
    0: { name: "dirt", solid: true, resistance: 0.5 },
    1: { name: "stone", solid: true, resistance: 6 },
    2: { name: "sand", solid: true, resistance: 0.5 },
    3: { name: "air", solid: false, resistance: 0 },
    4: { name: "oak_planks", solid: true, resistance: 3 },
    5: { name: "cobblestone", solid: true, resistance: 6 },
  };
  const weak = weakCells(cells, (p: { x: number }) => world[p.x] ?? null).map((p: { x: number }) => p.x);
  expect(weak).toEqual([0, 2, 4]);
});
