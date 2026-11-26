// A creeper some way off must not take the body while a zombie is hitting the
// bot: in the first game test the creeper reflex walked toward a creeper 9
// blocks away for half a minute and a zombie killed the bot meanwhile.
import { EventEmitter } from "node:events";
import { afterAll, expect, test } from "bun:test";
import { endConnection, useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");

const mob = (id: number, name: string, x: number) => ({ id, name, type: "hostile", position: new Vec3(x, 64, 0), metadata: [] });
let entities: Record<number, any> = {};
const fake: any = Object.assign(new EventEmitter(), {
  registry,
  entity: { position: new Vec3(0.5, 64, 0.5) },
  health: 20,
  time: { timeOfDay: 1000 },
  inventory: { items: () => [] },
  world: { raycast: () => null, getBlock: () => null }, // open ground: it can see the creeper
  nearestEntity: (match: (e: any) => boolean) =>
    Object.values(entities)
      .filter(match)
      .sort((a: any, b: any) => a.position.distanceTo(fake.entity.position) - b.position.distanceTo(fake.entity.position))[0] ?? null,
  stopDigging: () => {},
  clearControlStates: () => {},
  setControlState: () => {},
  pathfinder: { goal: null, setGoal: () => {}, isMoving: () => false },
});
useFakeBot(fake);
const setMobs = (mobs: Record<number, any>): void => {
  entities = mobs;
  fake.entities = mobs;
};
const { registerCreeperReflex, isCreeperReflexActive } = await import(`${ROOT}/src/actions/creeperReflex.ts`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a zombie at arm's length: the creeper 9 blocks away waits, the fight comes first", async () => {
  setMobs({ 1: mob(1, "creeper", 9), 2: mob(2, "zombie", 1.5) });
  registerCreeperReflex();
  await sleep(400);
  expect(isCreeperReflexActive()).toBe(false);
});

// The reflex timer must not outlive this file
afterAll(() => endConnection());

test("a creeper left be stays left be unless it really comes closer (game test: frozen 12 minutes)", async () => {
  const { cameCloser } = await import(`${ROOT}/src/actions/creeperReflex.ts`);
  // Left at 4.1, still 4.1 and in sight: left be
  expect(cameCloser(4.1, true, 4.1)).toBe(false);
  // A block nearer, or in fuse range: dealt with
  expect(cameCloser(2.9, true, 4.1)).toBe(true);
  expect(cameCloser(5, true, 9)).toBe(true);
  // Left from farther than 6, now within 6: dealt with
  expect(cameCloser(5.5, true, 6.4)).toBe(true);
  // Behind a wall: never
  expect(cameCloser(2, false, 4.1)).toBe(false);
});
