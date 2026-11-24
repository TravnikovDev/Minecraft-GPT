// Names from the LLM are checked at the gateway: real names pass normalised,
// kinds a command understands pass, anything else gets a clarifying question.
import { beforeEach, expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const fake = { registry: require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4") };
useFakeBot(fake);
beforeEach(() => useFakeBot(fake));
const { checkNames } = await import(`${ROOT}/src/managers/nameGate.ts`);

const run = (command: string, args: Record<string, unknown>) => ({ question: checkNames(command, args), args });

test('"collect 5 iron" gets a clarifying question', () => {
  const { question } = run("collectBlocks", { blockType: "iron", num: 5, range: null });
  expect(question).toContain('I don\'t know the block "iron". Did you mean');
  expect(question).toContain("iron ore");
});

test("ore items collect from their ores; real blocks pass", () => {
  expect(run("collectBlocks", { blockType: "diamond", num: 3 }).question).toBeNull();
  expect(run("collectBlocks", { blockType: "coal", num: 3 }).question).toBeNull();
  expect(run("collectBlocks", { blockType: "cherry_log", num: 3 }).question).toBeNull();
});

test("craft: exact, plural, generic kinds and sets pass; nonsense is questioned", () => {
  const torches = run("craftItem", { itemName: "Torches", itemCount: 4 });
  expect(torches.question).toBeNull();
  expect(torches.args.itemName).toBe("torch");
  for (const name of ["bed", "planks", "helmet", "boat", "armor", "iron_armor", "stone_tools", "pickaxe"]) {
    expect(run("craftItem", { itemName: name, itemCount: 1 }).question).toBeNull();
  }
  expect(run("craftItem", { itemName: "dimond_sword", itemCount: 1 }).question).toContain("diamond sword");
});

test("mobs: real names pass (plural too), null means any, nonsense is questioned", () => {
  expect(run("hunting", { mobType: "sheep", count: 1 }).question).toBeNull();
  const cows = run("hunting", { mobType: "cows", count: 2 });
  expect(cows.question).toBeNull();
  expect(cows.args.mobType).toBe("cow");
  expect(run("hunting", { mobType: null, count: 1 }).question).toBeNull();
  expect(run("hunting", { mobType: "dragonn", count: 1 }).question).toContain("mob");
});

test("commands without name checks are left alone", () => {
  expect(run("followPlayer", { player_name: "Travnikov" }).question).toBeNull();
});
