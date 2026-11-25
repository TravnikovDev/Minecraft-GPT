// Putting things in a chest is checked against the chest window's own copy of
// the bot's inventory: mineflayer updates bot.inventory only when the window
// closes, so counting bot.inventory said every deposit "didn't go in" in the
// first game test, though the items were in the chest.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;

const stack = (name: string, count: number): any => ({ name, type: 1, count, stackSize: 64, nbt: null, slot: 30 });
const stale = [stack("cobblestone", 37)]; // bot.inventory: unchanged until the window closes
let windowCopy = [stack("cobblestone", 37)];
const chest: any[] = [];
useFakeBot({
  entity: { position: { x: 0, y: 64, z: 0 } },
  inventory: { items: () => stale, emptySlotCount: () => 30 },
});
const { depositInto } = await import(`${ROOT}/src/core/containers.ts`);

test("a deposit counts from the chest window, not the stale inventory", async () => {
  const open = {
    inventoryStart: 27,
    containerItems: () => chest,
    items: () => windowCopy,
    close: () => {},
    deposit: async (_t: number, _m: unknown, n: number) => {
      windowCopy = [stack("cobblestone", 37 - n)];
      chest.push(stack("cobblestone", n));
    },
    withdraw: async () => {},
  };
  const result = await depositInto(open, stale[0], 37);
  expect(result).toMatchObject({ ok: true, value: 37 });
});
