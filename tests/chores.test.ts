// "stop" always works, idle chores included: a chore that is walking to pick
// things up ends at once, doesn't start again while stop keeps chores quiet,
// and a chore that never settles (a walk cut off by a disconnect) can't block
// the next one. Chores never take the big steps (making a chest, a tool).
import { EventEmitter } from "node:events";
import { beforeEach, expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);

// Walking takes a while; changing or clearing the goal ends the walk, as in the game
let pendingWalk: ((error: Error) => void) | null = null;
const walks: string[] = [];
const fake: any = Object.assign(new EventEmitter(), {
  entity: { position: new Vec3(0, 64, 0) },
  entities: {} as Record<number, any>,
  vehicle: null,
  inventory: { emptySlotCount: () => 30, items: () => [] },
  world: { raycast: () => null, getBlock: () => null },
  players: {},
  stopDigging: () => {},
  clearControlStates: () => {},
  pathfinder: {
    goal: null,
    isMoving: () => false,
    setGoal: () => {
      pendingWalk?.(new Error("The goal was changed before it could be completed!"));
      pendingWalk = null;
    },
    goto: (goal: any) => {
      walks.push(`${goal.x},${goal.z}`);
      return new Promise<void>((resolve, reject) => {
        pendingWalk = reject;
        setTimeout(resolve, 400);
      });
    },
  },
});
useFakeBot(fake);
const { runChore, stopChores, isChoreRunning, areChoresMuted, inChore, resetChores } = await import(`${ROOT}/src/core/chores.ts`);
const { collectDrops } = await import(`${ROOT}/src/actions/pickup.ts`);
const { isCommandCancelled } = await import(`${ROOT}/src/core/commandContext.ts`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function itemAt(id: number, x: number) {
  return { id, name: "item", position: new Vec3(x, 64, 0), onGround: true, getDroppedItem: () => ({ name: "cobblestone", count: 1 }) };
}

beforeEach(() => {
  useFakeBot(fake);
  resetChores();
  walks.length = 0;
  fake.entities = { 1: itemAt(1, 3), 2: itemAt(2, 6), 3: itemAt(3, 9) };
});

test("stop ends a chore mid-walk, and it doesn't start again while chores are quiet", async () => {
  const chore = runChore("tidying up", async () => {
    await collectDrops(12);
  });
  await sleep(100); // walking to the first item
  expect(isChoreRunning()).toBe(true);
  await stopChores("Stopped by player", 60_000);
  expect(isChoreRunning()).toBe(false);
  await chore;
  await sleep(500);
  expect(walks.length).toBe(1); // never went on to the next item
  expect(areChoresMuted()).toBe(true);
  expect(await runChore("tidying up", async () => {})).toBe(false);
});

test("a new command ends the chore without muting chores", async () => {
  const chore = runChore("replanting", async () => {
    while (!isCommandCancelled()) await sleep(20);
  });
  await sleep(50);
  await stopChores("collectBlocks started");
  await chore;
  expect(isChoreRunning()).toBe(false);
  expect(areChoresMuted()).toBe(false);
});

test("a chore that never settles can't block the next one", async () => {
  void runChore("taking down scaffolding", () => new Promise<void>(() => {})); // a walk cut off by a disconnect
  await sleep(20);
  const started = Date.now();
  await stopChores("disconnected");
  expect(Date.now() - started).toBeLessThan(4000);
  expect(isChoreRunning()).toBe(false);
  expect(await runChore("tidying up", async () => {})).toBe(true);
});

test("code knows when it runs for a chore", async () => {
  expect(inChore()).toBe(false);
  let inside = false;
  await runChore("tidying up", async () => {
    await sleep(5);
    inside = inChore();
  });
  expect(inside).toBe(true);
});

test("no idle chores at night unless it's well equipped: they wait for the morning", async () => {
  const { asBackgroundJob } = await import(`${ROOT}/src/actions/pickup.ts`);
  fake.game = { dimension: "overworld" };
  fake.time = { timeOfDay: 18000, age: 18000 }; // midnight
  try {
    let ran = false;
    expect(await asBackgroundJob("taking down scaffolding", async () => void (ran = true))).toBe(false);
    expect(ran).toBe(false);
    expect(isChoreRunning()).toBe(false);
    // By day it runs
    fake.time = { timeOfDay: 1000, age: 1000 };
    expect(await asBackgroundJob("taking down scaffolding", async () => void (ran = true))).toBe(true);
    expect(ran).toBe(true);
  } finally {
    delete fake.time;
    delete fake.game;
  }
});
