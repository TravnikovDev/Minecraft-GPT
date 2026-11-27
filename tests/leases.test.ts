// Phase 4: reflexes pause tasks instead of fighting them for the body. While
// a reflex has the hands, the task's next action waits; a dig cut off by a
// reflex is tried again once it lets go; eating slots in between two of the
// task's actions instead of grabbing the hands mid-dig.
import { EventEmitter } from "node:events";
import { beforeEach, expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const Block = require(`${ROOT}/node_modules/prismarine-block`)(registry);
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);

const key = (p: any) => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
let world = new Map<string, string>();
function blockAt(p: any) {
  const pos = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  const b = Block.fromStateId(registry.blocksByName[world.get(key(pos)) ?? (pos.y < 64 ? "stone" : "air")].defaultState, 0);
  b.position = pos;
  return b;
}
const item = (name: string, count: number) => ({ name, count, type: registry.itemsByName[name].id, stackSize: 64 });
let inv: any[] = [];
const events: string[] = [];
let digCut: (() => void) | null = null;

const fake: any = Object.assign(new EventEmitter(), {
  registry,
  game: { gameMode: "survival" },
  entity: { position: new Vec3(0.5, 64, 0.5), height: 1.62 },
  player: { ping: 5 },
  heldItem: null,
  inventory: { items: () => inv, emptySlotCount: () => 30, slots: [] },
  blockAt,
  canDigBlock: () => true,
  digTime: () => 200,
  lookAt: async () => {},
  equip: async (it: any) => {
    fake.heldItem = it;
    events.push(`equip ${it.name}`);
  },
  consume: async () => {
    events.push("eat");
    inv = inv.filter((i) => i.name !== "bread");
  },
  stopDigging: () => digCut?.(),
  clearControlStates: () => {},
  // A dig takes a moment; a reflex taking over stops it
  dig: (b: any) =>
    new Promise<void>((resolve, reject) => {
      events.push(`dig ${key(b.position)}`);
      const timer = setTimeout(() => {
        world.set(key(b.position), "air");
        digCut = null;
        resolve();
      }, 150);
      digCut = () => {
        clearTimeout(timer);
        digCut = null;
        reject(new Error("Digging aborted"));
      };
    }),
  pathfinder: { goal: null, setGoal: () => {}, isMoving: () => false },
});
useFakeBot(fake);
const L = await import(`${ROOT}/src/core/leases.ts`);
const R = await import(`${ROOT}/src/core/reflexes.ts`);
const P = await import(`${ROOT}/src/core/primitives.ts`);
const { takeOverBody } = await import(`${ROOT}/src/core/plugins.ts`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  useFakeBot(fake);
  L.resetLeases();
  R.resetReflexes();
  world = new Map();
  inv = [item("bread", 3)];
  events.length = 0;
  fake.heldItem = null;
});

test("while a reflex has the hands, the task's next action waits for it", async () => {
  world.set("1,64,0", "dirt");
  R.setReflexActive("creeper", true);
  const dig = P.breakBlock({ x: 1, y: 64, z: 0 });
  await sleep(100);
  expect(events).toEqual([]); // paused, not failed
  R.setReflexActive("creeper", false);
  expect(await dig).toMatchObject({ ok: true });
  expect(events).toEqual(["dig 1,64,0"]);
});

test("the reflex's own actions don't wait for itself", async () => {
  R.setReflexActive("combat", true);
  const r = await R.asReflex("combat", () => P.equipItem("bread", "hand"));
  expect(r).toMatchObject({ ok: true });
  R.setReflexActive("combat", false);
});

test("a dig cut off by a reflex is tried again once the reflex lets go", async () => {
  world.set("1,64,0", "dirt");
  const dig = P.breakBlock({ x: 1, y: 64, z: 0 });
  await sleep(50); // digging
  R.setReflexActive("creeper", true);
  takeOverBody(); // the creeper reflex stops the dig
  await sleep(100);
  R.setReflexActive("creeper", false);
  expect(await dig).toMatchObject({ ok: true });
  expect(events).toEqual(["dig 1,64,0", "dig 1,64,0"]);
});

test("eating waits for a gap between the task's actions, and the task waits while it eats", async () => {
  world.set("1,64,0", "dirt");
  world.set("2,64,0", "dirt");
  const task = (async () => {
    await P.breakBlock({ x: 1, y: 64, z: 0 });
    await P.breakBlock({ x: 2, y: 64, z: 0 });
  })();
  await sleep(30); // first dig under way
  const ate = L.borrow({ name: "eating", bucket: 4 }, ["hands"], () => P.consumeItem("bread"));
  await Promise.all([task, ate]);
  const firstDigDone = events.indexOf("dig 1,64,0");
  const eat = events.indexOf("eat");
  const secondDig = events.indexOf("dig 2,64,0");
  expect(firstDigDone).toBe(0); // never interrupted
  expect(eat).toBeGreaterThan(firstDigDone);
  expect(secondDig).toBeGreaterThan(eat); // the next dig waited for the meal
});

test("the most urgent holder wins: running out of air outranks a creeper", () => {
  R.setReflexActive("creeper", true);
  R.setReflexActive("drowning", true);
  expect(L.mayUse("movement", R.reflexHolder("drowning"))).toBe(true);
  expect(L.mayUse("movement", R.reflexHolder("creeper"))).toBe(false);
  R.setReflexActive("drowning", false);
  expect(L.mayUse("movement", R.reflexHolder("creeper"))).toBe(true);
  R.setReflexActive("creeper", false);
  expect(R.isAnyReflexActive()).toBe(false);
});

test("eating picks the most filling food; rotten flesh when there's nothing better (owner), other junk only when starving", async () => {
  const { pickFood } = await import(`${ROOT}/src/actions/upkeep.ts`);
  const foods = registry.foodsByName;
  const items = [{ name: "rotten_flesh" }, { name: "bread" }, { name: "cooked_beef" }];
  expect(pickFood(items, foods, false, false)).toBe("cooked_beef");
  expect(pickFood([{ name: "rotten_flesh" }], foods, false, false)).toBe("rotten_flesh");
  expect(pickFood([{ name: "rotten_flesh" }, { name: "bread" }], foods, false, false)).toBe("bread");
  expect(pickFood([{ name: "spider_eye" }], foods, false, false)).toBeNull();
  expect(pickFood([{ name: "spider_eye" }], foods, true, false)).toBe("spider_eye");
});
