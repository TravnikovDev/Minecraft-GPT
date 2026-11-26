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
