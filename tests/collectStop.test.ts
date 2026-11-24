// "stop" during collecting must end the collect loop. In the game it didn't:
// every retry failed with "Cancelled" and the loop spun forever.
import { beforeEach, expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const Block = require(`${ROOT}/node_modules/prismarine-block`)(registry);
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);

const ore = new Vec3(5, 60, 5);
let gotos = 0;
let onGoto: () => void = () => {};
const blockAt = (p: any) => {
  const name = p.equals?.(ore) ? "coal_ore" : "air"; // an ore in plain sight: walked to, not tunnelled to
  const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
  b.position = new Vec3(p.x, p.y, p.z);
  return b;
};
const fake = {
  registry,
  version: "1.20.4",
  vehicle: null,
  game: { gameMode: "creative" },
  entity: { position: new Vec3(0, 61, 0), eyeHeight: 1.62 },
  entities: {},
  inventory: { items: () => [], emptySlotCount: () => 30 },
  findBlocks: () => [ore],
  blockAt,
  world: { getBlock: blockAt, raycast: () => blockAt(ore) },
  pathfinder: {
    movements: {},
    goto: async () => {
      gotos++;
      onGoto();
      throw new Error("GoalChanged: The goal was changed before it could be completed!");
    },
    setGoal: () => {},
    isMoving: () => false,
  },
};
useFakeBot(fake);
beforeEach(() => {
  useFakeBot(fake);
  gotos = 0;
});
const { collectBlock } = await import(`${ROOT}/src/actions/collectBlock.ts`);
const { runWithSignal } = await import(`${ROOT}/src/core/commandContext.ts`);

test("a stop during the walk ends collecting instead of retrying forever", async () => {
  const abort = new AbortController();
  onGoto = () => abort.abort("Stopped by player"); // the owner says stop mid-walk
  const started = Date.now();
  const result = await runWithSignal(abort.signal, () => collectBlock("coal_ore", 5, 16));
  expect(result).toBe(0); // none collected
  expect(gotos).toBe(1);
  expect(Date.now() - started).toBeLessThan(1000);
});

test("an ore it can never reach is given up after a few tries", async () => {
  onGoto = () => {};
  const result = await runWithSignal(new AbortController().signal, () => collectBlock("coal_ore", 5, 16));
  expect(result).toBe(0); // none collected
  expect(gotos).toBe(5);
});
