// Hunting plans like a player: the whole group of common game, a breeding
// pair of each kind left alive, never babies or named pets.
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { planHunt, countList } = await import(`${ROOT}/src/actions/hunting.ts`);

let nextId = 1;
const animal = (name: string, extra: Partial<{ baby: boolean; named: boolean; distance: number }> = {}) => ({
  id: nextId++,
  name,
  distance: extra.distance ?? 10,
  baby: extra.baby ?? false,
  named: extra.named ?? false,
});
const herd = (name: string, n: number) => Array.from({ length: n }, () => animal(name));

test("a general hunt takes every common kind it sees, no breeding pair left in the wild (owner)", () => {
  const plan = planHunt([...herd("cow", 5), ...herd("sheep", 3), ...herd("chicken", 2)], null, null);
  expect(Object.fromEntries(plan.seen)).toEqual({ cow: 5, sheep: 3, chicken: 2 });
  expect(Object.fromEntries(plan.take)).toEqual({ cow: 5, sheep: 3, chicken: 2 });
  expect(plan.total).toBe(10);
});

test("babies and named animals (pets) are never game", () => {
  const plan = planHunt([...herd("pig", 3), animal("pig", { baby: true }), animal("pig", { named: true })], null, null);
  expect(plan.seen.get("pig")).toBe(3);
  expect(plan.take.get("pig")).toBe(3);
});

test("only common game unless the owner names the animal", () => {
  expect(planHunt([...herd("horse", 4), ...herd("wolf", 4)], null, null).seen.size).toBe(0);
  expect(planHunt(herd("horse", 4), "horse", null).take.get("horse")).toBe(4);
});

test("a count from the owner is followed as asked, no pair kept back", () => {
  const plan = planHunt(herd("sheep", 3), "sheep", 3);
  expect(plan.total).toBe(3);
  expect(planHunt(herd("sheep", 2), "sheep", 5).total).toBe(2); // can't take more than are there
});

test("a pair in sight is hunted too (owner: no point leaving pairs in the wild)", () => {
  expect(planHunt(herd("cow", 2), null, null).total).toBe(2);
});

test("the report reads naturally", () => {
  expect(countList(new Map([["cow", 3], ["sheep", 1], ["chicken", 2]]))).toBe("3 cows, 1 sheep and 2 chickens");
  expect(countList(new Map([["beef", 5], ["leather", 2]]))).toBe("5 beef and 2 leather");
  expect(countList(new Map([["porkchop", 1]]))).toBe("1 porkchop");
});

test("an animal in a cave is no food to go for; one in the open or under a tree is", async () => {
  // Game test: it dug a 147-block tunnel down to y 7 after a chicken in a cave
  const { skyAbove } = await import(`${import.meta.dir}/../src/actions/hunting.ts`);
  const STONE = { name: "stone", boundingBox: "block" };
  const LEAVES = { name: "oak_leaves", boundingBox: "block" };
  const AIR = { name: "air", boundingBox: "empty" };
  // A chicken at y 8 with rock from y 20 up
  expect(skyAbove({ x: 0, y: 8, z: 0 }, (_x: number, y: number) => (y >= 20 ? STONE : AIR))).toBe(false);
  // Out in a field
  expect(skyAbove({ x: 0, y: 64, z: 0 }, () => AIR)).toBe(true);
  // Under a tree
  expect(skyAbove({ x: 0, y: 64, z: 0 }, (_x: number, y: number) => (y === 70 ? LEAVES : AIR))).toBe(true);
});

test("a food-stock hunt takes up to its number", () => {
  expect(planHunt([...herd("cow", 5), ...herd("pig", 2)], null, null, 2).total).toBe(2);
  expect(planHunt(herd("cow", 4), null, null, 10).total).toBe(4);
});
