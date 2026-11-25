// Shut in its shelter at night, the bot stays put: a mob outside (seen
// through the ground or not) is no reason to dig out (first game test: it
// broke its own seal to fight a phantom 5 blocks of earth above). Out in the
// open it fights only what it can see, or what is right next to it.
import { EventEmitter } from "node:events";
import { afterAll, beforeEach, expect, test } from "bun:test";
import { endConnection, useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");

const mob = (id: number, name: string, x: number, y = 64) => ({ id, name, type: "hostile", height: 1.95, position: new Vec3(x, y, 0), metadata: [] });
let wall = false; // something solid between the bot and the mob
const fake: any = Object.assign(new EventEmitter(), {
  registry,
  entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8 },
  health: 20,
  time: { timeOfDay: 14000 },
  inventory: { items: () => [] },
  world: { raycast: () => (wall ? { name: "dirt", position: new Vec3(0, 66, 0) } : null), getBlock: () => null },
  attack: () => {},
  swingArm: () => {},
  lookAt: async () => {},
  stopDigging: () => {},
  clearControlStates: () => {},
  setControlState: () => {},
  pathfinder: { goal: null, setGoal: () => {}, isMoving: () => false, stop: () => {} },
  pvp: { attack: () => {}, stop: () => {}, target: null, forceStop: () => {} },
});
fake.nearestEntity = (match: (e: any) => boolean) =>
  Object.values(fake.entities)
    .filter(match)
    .sort((a: any, b: any) => a.position.distanceTo(fake.entity.position) - b.position.distanceTo(fake.entity.position))[0] ?? null;
useFakeBot(fake);
const { registerCombatReflex } = await import(`${ROOT}/src/actions/combatReflex.ts`);
const { isAnyReflexActive, resetReflexes } = await import(`${ROOT}/src/core/reflexes.ts`);
const { setSheltered } = await import(`${ROOT}/src/core/sheltered.ts`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
registerCombatReflex();
// The fight in the last test holds the body: let go of it and stop the timer,
// or every later test file waits for its turn forever
afterAll(() => {
  fake.entities = {};
  resetReflexes();
  endConnection();
});
beforeEach(async () => {
  resetReflexes(); // a "stop" from an earlier test file mutes reflexes for a while
  fake.entities = {};
  setSheltered(false);
  await sleep(300); // the reflex lets go of whatever it had
});

test("night, a zombie 6 blocks off behind ground: no fight", async () => {
  wall = true;
  fake.entities = { 9101: mob(9101, "zombie", 6, 69) };
  await sleep(400);
  expect(isAnyReflexActive()).toBe(false);
});

test("shut in the shelter: a zombie in plain sight outside isn't fought either", async () => {
  wall = false;
  setSheltered(true);
  fake.entities = { 9101: mob(9101, "zombie", 6) };
  await sleep(400);
  expect(isAnyReflexActive()).toBe(false);
});

test("out in the open at night, a zombie in plain sight is fought", async () => {
  wall = false;
  fake.entities = { 9101: mob(9101, "zombie", 6) };
  await sleep(400);
  expect(isAnyReflexActive()).toBe(true);
});
