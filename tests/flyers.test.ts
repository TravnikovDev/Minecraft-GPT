// Flying mobs aren't chased (that built dirt pillars after a phantom and kept
// the bot out of its shelter all night); one within reach gets a swing.
import { EventEmitter } from "node:events";
import { afterAll, expect, test } from "bun:test";
import { endConnection, useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");

const mob = (id: number, name: string, x: number, y = 64) => ({ id, name, type: "hostile", height: 0.5, position: new Vec3(x, y, 0), metadata: [] });
let entities: Record<number, any> = {};
const swings: string[] = [];
const fake: any = Object.assign(new EventEmitter(), {
  registry,
  entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8 },
  health: 20,
  time: { timeOfDay: 14000 },
  inventory: { items: () => [] },
  nearestEntity: (match: (e: any) => boolean) =>
    Object.values(entities)
      .filter(match)
      .sort((a: any, b: any) => a.position.distanceTo(fake.entity.position) - b.position.distanceTo(fake.entity.position))[0] ?? null,
  attack: (e: any) => swings.push(e.name),
  swingArm: () => {},
  lookAt: async () => {},
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
const { registerCombatReflex } = await import(`${ROOT}/src/actions/combatReflex.ts`);
const { isAnyReflexActive } = await import(`${ROOT}/src/core/reflexes.ts`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
afterAll(() => endConnection());

test("a phantom 6 blocks up at night: no chase, the walk goes on", async () => {
  setMobs({ 1: mob(1, "phantom", 3, 70) });
  registerCombatReflex();
  await sleep(500);
  expect(isAnyReflexActive()).toBe(false);
  expect(swings).toEqual([]);
});

test("a phantom swooping within reach gets a swing", async () => {
  setMobs({ 1: mob(1, "phantom", 2, 65) });
  await sleep(500);
  expect(swings).toContain("phantom");
  expect(isAnyReflexActive()).toBe(false);
});
