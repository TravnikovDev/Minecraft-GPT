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

test("a general hunt takes every common kind it sees, leaving two of each", () => {
  const plan = planHunt([...herd("cow", 5), ...herd("sheep", 3), ...herd("chicken", 2)], null, null);
  expect(Object.fromEntries(plan.seen)).toEqual({ cow: 5, sheep: 3, chicken: 2 });
  expect(Object.fromEntries(plan.take)).toEqual({ cow: 3, sheep: 1 }); // chickens: only a pair, left alone
  expect(plan.total).toBe(4);
  expect(plan.keepsPairs).toBe(true);
});

test("babies and named animals (pets) are never game", () => {
  const plan = planHunt([...herd("pig", 3), animal("pig", { baby: true }), animal("pig", { named: true })], null, null);
  expect(plan.seen.get("pig")).toBe(3);
  expect(plan.take.get("pig")).toBe(1);
});

test("only common game unless the owner names the animal", () => {
  expect(planHunt([...herd("horse", 4), ...herd("wolf", 4)], null, null).seen.size).toBe(0);
  expect(planHunt(herd("horse", 4), "horse", null).take.get("horse")).toBe(2);
});

test("a count from the owner is followed as asked, no pair kept back", () => {
  const plan = planHunt(herd("sheep", 3), "sheep", 3);
  expect(plan.total).toBe(3);
  expect(plan.keepsPairs).toBe(false);
  expect(planHunt(herd("sheep", 2), "sheep", 5).total).toBe(2); // can't take more than are there
});

test("only a breeding pair in sight means nothing to hunt", () => {
  expect(planHunt(herd("cow", 2), null, null).total).toBe(0);
});

test("the report reads naturally", () => {
  expect(countList(new Map([["cow", 3], ["sheep", 1], ["chicken", 2]]))).toBe("3 cows, 1 sheep and 2 chickens");
  expect(countList(new Map([["beef", 5], ["leather", 2]]))).toBe("5 beef and 2 leather");
  expect(countList(new Map([["porkchop", 1]]))).toBe("1 porkchop");
});
