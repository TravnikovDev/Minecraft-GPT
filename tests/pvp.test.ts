// The real mineflayer-pvp plugin must not swap in its dig-anything walking rules.
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const { EventEmitter } = require("events");
const { PVP } = require(`${ROOT}/node_modules/mineflayer-pvp/lib/PVP.js`);
const { safeMovements, isSafeMovements } = await import(`${ROOT}/src/core/movements.ts`);

function fakeBot(): any {
  const bot: any = new EventEmitter();
  Object.assign(bot, {
    registry, version: "1.20.4", supportFeature: () => false,
    blockAt: () => null, world: { getBlock: () => null }, entity: { position: { x: 0, y: 64, z: 0 } },
  });
  bot.pathfinder = { movements: null, setMovements(m: any) { this.movements = m; }, setGoal() {}, stop() {} };
  return bot;
}
const cobble = registry.blocksByName.cobblestone.id;

test("without the fix, an attack swaps in rules that dig cobblestone (the village bug)", async () => {
  const bot = fakeBot();
  bot.pathfinder.setMovements(safeMovements(bot));
  const pvp = new PVP(bot);
  await pvp.attack({ id: 1, position: { x: 3, y: 64, z: 0 } });
  expect(isSafeMovements(bot.pathfinder.movements)).toBe(false);
  expect(bot.pathfinder.movements.blocksCantBreak.has(cobble)).toBe(false);
});

test("with pvp given the safe rules, walking rules stay safe after an attack", async () => {
  const bot = fakeBot();
  const rules = safeMovements(bot);
  bot.pathfinder.setMovements(rules);
  const pvp = new PVP(bot);
  pvp.movements = rules; // what index.ts and fighting.attack now do
  await pvp.attack({ id: 1, position: { x: 3, y: 64, z: 0 } });
  expect(isSafeMovements(bot.pathfinder.movements)).toBe(true);
  expect(bot.pathfinder.movements.blocksCantBreak.has(cobble)).toBe(true);
});
