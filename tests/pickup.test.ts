// Picking up drops like a player. The fake world behaves like the game:
// fresh drops fly for a moment, can't be picked up for half a second, vanish
// once the bot stands next to them, and some can't be reached.
import { EventEmitter } from "node:events";
import { beforeEach, expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);

const PICKUP_DELAY_MS = 500; // the game's pickup delay for fresh drops
type FakeItem = { id: number; name: string; position: any; onGround: boolean; spawnedAt: number; unreachable?: boolean };

const fake: any = Object.assign(new EventEmitter(), {
  entity: { position: new Vec3(0, 64, 0) },
  entities: {} as Record<number, FakeItem>,
  vehicle: null,
  inventory: { emptySlotCount: () => 30 },
  world: { raycast: () => null, getBlock: () => null },
  players: {},
  visited: [] as number[],
  pathfinder: {
    goal: null,
    isMoving: () => false,
    setGoal: () => {},
    goto: async (goal: any) => {
      const item = Object.values(fake.entities as Record<number, FakeItem>).find((e) => e.position.x === goal.x && e.position.z === goal.z);
      if (item?.unreachable) throw new Error("No path to the goal!");
      await new Promise((r) => setTimeout(r, 50)); // walking
      fake.entity.position = new Vec3(goal.x, goal.y, goal.z);
      if (item) fake.visited.push(item.id);
    },
  },
});

let nextId = 1;
function drop(x: number, extra: Partial<FakeItem> = {}): FakeItem {
  const item: FakeItem = { id: nextId++, name: "item", position: new Vec3(x, 64, 0), onGround: false, spawnedAt: Date.now(), ...extra };
  fake.entities[item.id] = item;
  setTimeout(() => (item.onGround = true), 300);
  return item;
}

// The game hands an item over once the bot stands next to it and the delay has passed
setInterval(() => {
  for (const item of Object.values(fake.entities as Record<number, FakeItem>)) {
    const near = item.position.distanceTo(fake.entity.position) <= 1.5;
    if (near && Date.now() - item.spawnedAt >= PICKUP_DELAY_MS) delete fake.entities[item.id];
  }
}, 50);

useFakeBot(fake);
beforeEach(() => {
  useFakeBot(fake);
  fake.entities = {};
  fake.visited = [];
  fake.entity.position = new Vec3(0, 64, 0);
});
const { collectDrops, tossing } = await import(`${ROOT}/src/actions/pickup.ts`);
const { runWithSignal } = await import(`${ROOT}/src/core/commandContext.ts`);

test("fresh drops still in the air are all picked up, nearest first", async () => {
  const [a, b, c] = [drop(5), drop(2), drop(7)];
  expect(await collectDrops(8)).toBe(3);
  expect(fake.visited).toEqual([b.id, a.id, c.id]);
  expect(Object.keys(fake.entities)).toEqual([]);
});

test("an item still there on arrival (pickup delay) is waited for, not given up", async () => {
  const item = drop(1, { onGround: true, spawnedAt: Date.now() }); // arrives in 50 ms, pickable at 500 ms
  expect(await collectDrops(8)).toBe(1);
  expect(fake.entities[item.id]).toBeUndefined();
});

test("an unreachable item is skipped and the rest are still picked up", async () => {
  drop(3, { unreachable: true });
  const other = drop(5);
  expect(await collectDrops(8)).toBe(1);
  expect(fake.visited).toEqual([other.id]);
});

test("what it tossed itself is never picked back up", async () => {
  await tossing(async () => {
    const thrown = drop(1);
    fake.emit("entitySpawn", thrown);
  });
  const real = drop(4);
  expect(await collectDrops(8)).toBe(1);
  expect(fake.visited).toEqual([real.id]);
});

test("stop ends picking up", async () => {
  for (let x = 1; x <= 6; x++) drop(x);
  const abort = new AbortController();
  setTimeout(() => abort.abort("Stopped by player"), 120);
  const got = await runWithSignal(abort.signal, () => collectDrops(8));
  expect(got).toBeLessThan(6);
});

test("with no free slot it still picks up what stacks onto what it carries", async () => {
  const inv = fake.inventory;
  fake.inventory = { emptySlotCount: () => 0, items: () => [{ name: "beef", count: 10, stackSize: 64 }] };
  const leather = drop(2, { getDroppedItem: () => ({ name: "leather", count: 1 }) } as any);
  const beef = drop(4, { getDroppedItem: () => ({ name: "beef", count: 2 }) } as any);
  expect(await collectDrops(8)).toBe(1);
  expect(fake.visited).toEqual([beef.id]);
  expect(fake.entities[leather.id]).toBeDefined();
  fake.inventory = inv;
});
