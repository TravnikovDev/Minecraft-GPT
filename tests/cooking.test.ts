// Loading a furnace and leaving it (owner, 2026-11-28: "why is it standing by
// the furnace after it put everything in? It should load the furnace, go do
// another action, and check the furnace after that action is finished").
import { beforeEach, expect, test } from "bun:test";
import { Vec3 } from "vec3";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");

type Slot = { name: string; count: number } | null;
const furnacePos = new Vec3(2, 64, 0);
let inventory: Array<{ name: string; count: number }> = [];
let slots: { input: Slot; fuel: Slot; output: Slot } = { input: null, fuel: null, output: null };
let opened = 0;

const take = (name: string, n: number): void => {
  const it = inventory.find((i) => i.name === name)!;
  it.count -= n;
  inventory = inventory.filter((i) => i.count > 0);
};
const give = (s: Slot): void => {
  if (!s) return;
  const it = inventory.find((i) => i.name === s.name);
  if (it) it.count += s.count;
  else inventory.push({ ...s });
};
const nameOf = (id: number): string => registry.items[id].name;

useFakeBot({
  registry,
  entity: { position: new Vec3(0, 64, 0) },
  inventory: { items: () => inventory },
  findBlocks: (o: { matching: number[] }) => (o.matching.includes(registry.blocksByName.furnace.id) ? [furnacePos] : []),
  blockAt: (p: Vec3) => (p.equals(furnacePos) ? { name: "furnace", position: furnacePos, getProperties: () => ({}) } : { name: "air", position: p }),
  openFurnace: async () => {
    opened++;
    return {
      id: 1,
      inputItem: () => slots.input,
      fuelItem: () => slots.fuel,
      outputItem: () => slots.output,
      putInput: async (id: number, _m: null, n: number) => {
        take(nameOf(id), n);
        slots.input = { name: nameOf(id), count: (slots.input?.count ?? 0) + n };
      },
      putFuel: async (id: number, _m: null, n: number) => {
        take(nameOf(id), n);
        slots.fuel = { name: nameOf(id), count: (slots.fuel?.count ?? 0) + n };
      },
      takeOutput: async () => {
        give(slots.output);
        slots.output = null;
      },
      takeInput: async () => {
        give(slots.input);
        slots.input = null;
      },
    };
  },
  closeWindow: () => {},
});

const cooking = await import(`${ROOT}/src/actions/cooking.ts`);

beforeEach(() => {
  cooking.forgetOvens();
  inventory = [
    { name: "beef", count: 5 },
    { name: "coal", count: 3 },
  ];
  slots = { input: null, fuel: null, output: null };
  opened = 0;
});

test("left to cook: the beef and the coal for it go in and it walks off at once, the furnace remembered", async () => {
  const started = Date.now();
  const cooked = await cooking.cookFood(null, 64, true);
  expect(cooked).toBe(0); // nothing waited for
  expect(Date.now() - started).toBeLessThan(5000);
  expect(slots.input).toEqual({ name: "beef", count: 5 });
  expect(slots.fuel).toEqual({ name: "coal", count: 1 }); // one coal smelts 8
  const left = cooking.ovensLeft();
  expect(left).toHaveLength(1);
  expect(left[0]).toMatchObject({ x: 2, y: 64, z: 0, input: "beef", count: 5 });
  // About 10 s an item in a furnace: not done yet, so no visit yet
  expect(cooking.ovenToCheck()).toBe(false);
  // The food in it counts for its restock (steak is 8 points)
  expect(cooking.cookingFoodPoints()).toBe(5 * 8);
});

test("its next job done, it checks the furnace: what's done comes out and an empty furnace is forgotten", async () => {
  await cooking.cookFood(null, 64, true);
  // The furnace cooked it all meanwhile
  slots = { input: null, fuel: null, output: { name: "cooked_beef", count: 5 } };
  expect(await cooking.collectFromOvens(true)).toBe(5);
  expect(inventory.find((i) => i.name === "cooked_beef")?.count).toBe(5);
  expect(cooking.ovensLeft()).toHaveLength(0);
});

test("half done on its visit: the rest keeps cooking and it comes back for it later", async () => {
  await cooking.cookFood(null, 64, true);
  slots = { input: { name: "beef", count: 2 }, fuel: { name: "coal", count: 1 }, output: { name: "cooked_beef", count: 3 } };
  expect(await cooking.collectFromOvens(true)).toBe(3);
  const left = cooking.ovensLeft();
  expect(left).toHaveLength(1);
  expect(left[0]).toMatchObject({ input: "beef", count: 2 });
  expect(left[0].readyAt).toBeGreaterThan(Date.now());
});

test("a visit between tasks: only once it's done, and only near (not up or down its mine, not far off)", () => {
  const o = { x: 0, y: 64, z: 0, oven: "furnace", input: "beef", count: 5, readyAt: 1000, tries: 0 };
  expect(cooking.ovenDue(o, { x: 10, y: 64, z: 10 }, 999)).toBe(false);
  expect(cooking.ovenDue(o, { x: 10, y: 64, z: 10 }, 1000)).toBe(true);
  expect(cooking.ovenDue(o, { x: cooking.OVEN_VISIT_RANGE + 1, y: 64, z: 0 }, 1000)).toBe(false);
  expect(cooking.ovenDue(o, { x: 0, y: 40, z: 0 }, 1000)).toBe(false);
});
