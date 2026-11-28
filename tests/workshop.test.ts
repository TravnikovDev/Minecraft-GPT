// The workshop (owner: check the chests now and then and smelt the ores;
// make better blocks once a resource piles up).
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { pickSmeltJob } = await import(`${ROOT}/src/skills/workshop.ts`);

const stock = (s: Record<string, number>) => (name: string) => s[name] ?? 0;

test("raw ores first, a stack at most", () => {
  expect(pickSmeltJob(stock({ raw_iron: 100, raw_gold: 5 }))).toEqual({ input: "raw_iron", output: "iron_ingot", count: 64 });
  expect(pickSmeltJob(stock({ raw_gold: 5, sand: 200 }))).toEqual({ input: "raw_gold", output: "gold_ingot", count: 5 });
});

test("sand and cobblestone only once they pile up, keeping the pile", () => {
  expect(pickSmeltJob(stock({ sand: 20 }))).toBeNull();
  expect(pickSmeltJob(stock({ sand: 50 }))).toEqual({ input: "sand", output: "glass", count: 18 });
  expect(pickSmeltJob(stock({ cobblestone: 200 }))).toBeNull();
  expect(pickSmeltJob(stock({ cobblestone: 1400 }))).toEqual({ input: "cobblestone", output: "stone", count: 64 });
});

test("smooth stone only while the shelter wants it: stone smelted, and cobblestone sooner (owner: only with two stacks of coal)", () => {
  // Not wanted (tendFurnace counts stone as 0): nothing
  expect(pickSmeltJob(stock({ cobblestone: 200 }))).toBeNull();
  // Wanted: stone into smooth stone, else cobblestone into stone past no pile
  const wanted = (j: { input: string; above: number }) => (j.input === "cobblestone" ? 0 : j.above);
  expect(pickSmeltJob(stock({ stone: 20, cobblestone: 200 }), wanted)).toEqual({ input: "stone", output: "smooth_stone", count: 20 });
  expect(pickSmeltJob(stock({ cobblestone: 200 }), wanted)).toEqual({ input: "cobblestone", output: "stone", count: 64 });
});

test("charcoal from spare logs (owner: lots of wood after the clearing, and torches wanted): only while its light is short and it has 32+ spare logs", () => {
  const { charcoalBatch, LIGHT_WANTED, CHARCOAL_LOGS } = require(`${ROOT}/src/skills/workshop.ts`);
  expect(LIGHT_WANTED).toBe(128);
  expect(CHARCOAL_LOGS).toBe(32);
  // Light enough, or few spare logs: none
  expect(charcoalBatch(128, 200)).toBe(0);
  expect(charcoalBatch(0, 31)).toBe(0);
  // Short by 128 torches: 32 charcoal; its 40 spare logs cover 34 with the planks to burn
  expect(charcoalBatch(0, 40)).toBe(32);
  expect(charcoalBatch(0, 35)).toBe(30);
  // Nearly enough light: only what's short (4 torches a charcoal)
  expect(charcoalBatch(120, 100)).toBe(2);
});
