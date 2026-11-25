// Phase 6: getting an item from scratch. From an empty inventory, a stone
// pickaxe takes logs, a crafting table, a wooden pickaxe (stone needs a
// pickaxe), cobblestone, then the stone pickaxe, in that order; a source that
// fails is set aside and the next one tried; with nothing to get it from, it
// ends after a few rounds instead of looping.
import { beforeEach, expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { acquire, clearDemotions } = await import(`${ROOT}/src/skills/acquire.ts`);

// A tiny game: recipes (what each craft takes) and an inventory
const RECIPES: Record<string, { makes: number; takes: Record<string, number>; table?: boolean }> = {
  oak_planks: { makes: 4, takes: { logs: 1 } },
  crafting_table: { makes: 1, takes: { oak_planks: 4 } },
  stick: { makes: 4, takes: { oak_planks: 2 } },
  wooden_pickaxe: { makes: 1, takes: { oak_planks: 3, stick: 2 }, table: true },
  stone_pickaxe: { makes: 1, takes: { cobblestone: 3, stick: 2 }, table: true },
  white_bed: { makes: 1, takes: { white_wool: 3, oak_planks: 3 }, table: true },
  furnace: { makes: 1, takes: { cobblestone: 8 }, table: true },
  // Wool has a recipe too (4 string): the planner must still go to the sheep
  white_wool: { makes: 1, takes: { string: 4 } },
  torch: { makes: 4, takes: { coal: 1, stick: 1 } },
  iron_pickaxe: { makes: 1, takes: { iron_ingot: 3, stick: 2 }, table: true },
};
// The pickaxe each ore needs (wood 0, stone 1, iron 2), as in the game
const PICK = ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe"];
const ORE_TIER: Record<string, number> = { coal: 0, raw_iron: 1, diamond: 2 };
const pickTier = () => Math.max(-1, ...PICK.map((p, i) => ((inv[p] ?? 0) > 0 ? i : -1)));
let inv: Record<string, number> = {};
let log: string[] = [];
let trees = 10;
let sheep = 0;
let coalOre = 0;

// Like the real planner: deeper parts are crafted only when their inputs are
// at hand, or they're basic parts (planks, sticks, a table); otherwise the
// part itself is what's missing (a bed needs wool, not string)
const ALWAYS_EXPAND = new Set(["oak_planks", "stick", "crafting_table"]);

/** Raw materials missing for `count` of `item`, expanding what can be crafted. */
function missing(item: string, count: number, have = { ...inv }, out: Record<string, number> = {}, steps: string[] = [], depth = 0): Record<string, number> {
  const r = RECIPES[item];
  const short = Math.max(0, count - (have[item] ?? 0));
  const partsShort = r && Object.entries(r.takes).some(([part, n]) => (have[part] ?? 0) < n * Math.ceil(short / r.makes));
  if (!r || (depth > 0 && short > 0 && partsShort && !ALWAYS_EXPAND.has(item))) {
    if (short > 0) out[item] = (out[item] ?? 0) + short;
    have[item] = Math.max(0, (have[item] ?? 0) - count);
    return out;
  }
  if (short > 0) {
    const times = Math.ceil(short / r.makes);
    for (const [part, n] of Object.entries(r.takes)) missing(part, n * times, have, out, steps, depth + 1);
    steps.push(item);
    have[item] = (have[item] ?? 0) + times * r.makes;
  }
  have[item] = (have[item] ?? 0) - count;
  return out;
}
function craft(item: string, count: number): boolean {
  if (Object.keys(missing(item, count)).length > 0) return false;
  const r = RECIPES[item];
  if (!r) return (inv[item] ?? 0) >= count;
  const short = Math.max(0, count - (inv[item] ?? 0));
  const times = Math.ceil(short / r.makes);
  for (const [part, n] of Object.entries(r.takes)) if (!craft(part, n * times)) return false;
  if (r.table && !inv.crafting_table) return false;
  for (const [part, n] of Object.entries(r.takes)) inv[part] = (inv[part] ?? 0) - n * times;
  inv[item] = (inv[item] ?? 0) + times * r.makes;
  log.push(`craft ${item}`);
  return true;
}
const world = {
  have: (item: string) => inv[item] ?? 0,
  plan: (item: string, count: number) => {
    const steps: string[] = [];
    const out = missing(item, count, { ...inv }, {}, steps);
    return { missing: Object.entries(out).map(([name, n]) => ({ name, count: n })), needsTable: steps.some((s) => RECIPES[s]?.table) };
  },
  craft: async (item: string, count: number) => craft(item, count),
  tableAccess: () => (inv.crafting_table ?? 0) > 0,
  sources: [
    {
      name: "chopping trees",
      gets: (m: string) => m === "logs",
      run: async (_m: string, n: number) => {
        const got = Math.min(n, trees);
        trees -= got;
        inv.logs = (inv.logs ?? 0) + got;
        log.push(`chop ${got}`);
        return got > 0 ? { ok: true, value: undefined } : { ok: false, reason: "missing_items", detail: "no trees" };
      },
    },
    {
      name: "mining stone",
      gets: (m: string) => m === "cobblestone",
      needs: () => ((inv.wooden_pickaxe ?? 0) + (inv.stone_pickaxe ?? 0) > 0 ? [] : [{ item: "wooden_pickaxe", count: 1 }]),
      run: async (_m: string, n: number) => {
        inv.cobblestone = (inv.cobblestone ?? 0) + n;
        log.push(`mine ${n}`);
        return { ok: true, value: undefined };
      },
    },
    {
      name: "hunting sheep",
      gets: (m: string) => m.endsWith("_wool"),
      run: async (_m: string, n: number) => {
        const got = Math.min(n, sheep);
        sheep -= got;
        inv.white_wool = (inv.white_wool ?? 0) + got;
        log.push(`hunt ${got}`);
        return got > 0 ? { ok: true, value: undefined } : { ok: false, reason: "missing_items", detail: "no sheep" };
      },
    },
    {
      name: "mining ores",
      gets: (m: string) => m in ORE_TIER,
      needs: (m: string) => (pickTier() >= ORE_TIER[m]! ? [] : [{ item: PICK[ORE_TIER[m]!]!, count: 1 }]),
      run: async (m: string, n: number) => {
        if (pickTier() < ORE_TIER[m]!) throw new Error(`mined ${m} without the right pickaxe`);
        const got = m === "coal" ? Math.min(n, coalOre) : n;
        if (m === "coal") coalOre -= got;
        inv[m] = (inv[m] ?? 0) + got;
        log.push(`mine ${m} ${got}`);
        return got > 0 ? { ok: true, value: undefined } : { ok: false, reason: "missing_items", detail: `no ${m}` };
      },
    },
    {
      // Charcoal stands in for coal (the live world counts it as coal)
      name: "smelting",
      gets: (m: string) => m === "iron_ingot" || m === "coal",
      needs: (m: string, n: number) => [
        ...((inv.furnace ?? 0) > 0 ? [] : [{ item: "furnace", count: 1 }]),
        m === "coal" ? { item: "logs", count: n } : { item: "raw_iron", count: n },
      ],
      run: async (m: string, n: number) => {
        if (!inv.furnace) throw new Error("smelted without a furnace");
        const input = m === "coal" ? "logs" : "raw_iron";
        inv[input] = (inv[input] ?? 0) - n;
        inv[m] = (inv[m] ?? 0) + n;
        log.push(`smelt ${m} ${n}`);
        return { ok: true, value: undefined };
      },
    },
  ],
};

beforeEach(() => {
  inv = {};
  log = [];
  trees = 10;
  sheep = 0;
  coalOre = 0;
  clearDemotions();
});

test("a stone pickaxe from nothing: wood, a table, a wooden pickaxe, stone, then the stone pickaxe", async () => {
  const result = await acquire("stone_pickaxe", 1, world);
  expect(result.ok).toBe(true);
  expect(inv.stone_pickaxe).toBe(1);
  const order = log.map((l) => l.split(" ")[0] + " " + (l.split(" ")[1] ?? ""));
  const at = (what: string) => order.findIndex((o) => o.startsWith(what));
  expect(at("chop")).toBe(0);
  expect(at("craft crafting_table")).toBeLessThan(at("craft wooden_pickaxe"));
  expect(at("craft wooden_pickaxe")).toBeLessThan(at("mine"));
  expect(at("mine")).toBeLessThan(at("craft stone_pickaxe"));
});

test("already carried: nothing to do", async () => {
  inv = { stone_pickaxe: 1 };
  expect((await acquire("stone_pickaxe", 1, world)).ok).toBe(true);
  expect(log).toEqual([]);
});

test("no trees anywhere: it gives up quickly with the reason, no endless loop", async () => {
  trees = 0;
  const result = await acquire("wooden_pickaxe", 1, world);
  expect(result).toMatchObject({ ok: false, reason: "missing_items" });
  expect(log.filter((l) => l.startsWith("chop")).length).toBeLessThanOrEqual(1);
});

test("a bed needs wool: no sheep around means no bed, said plainly", async () => {
  inv = { logs: 4, crafting_table: 1 };
  const result = await acquire("white_bed", 1, world);
  expect(result.ok).toBe(false);
  expect(inv.white_bed ?? 0).toBe(0);
  sheep = 3;
  clearDemotions();
  expect((await acquire("white_bed", 1, world)).ok).toBe(true);
});

// --- The progression tree -----------------------------------------------------

test("torches with no coal ore around: a furnace from cobblestone, charcoal from logs, then torches", async () => {
  trees = 20;
  const result = await acquire("torch", 4, world);
  expect(result.ok).toBe(true);
  expect(inv.torch).toBeGreaterThanOrEqual(4);
  const at = (what: string) => log.findIndex((l) => l.startsWith(what));
  expect(at("mine coal")).toBeGreaterThanOrEqual(0); // tried coal ore first
  expect(at("craft wooden_pickaxe")).toBeLessThan(at("mine cobblestone") === -1 ? at("mine 8") : at("mine cobblestone"));
  expect(at("craft furnace")).toBeLessThan(at("smelt coal"));
  expect(at("smelt coal")).toBeLessThan(at("craft torch"));
});

test("torches with coal ore nearby: mined coal, no furnace needed", async () => {
  coalOre = 5;
  const result = await acquire("torch", 4, world);
  expect(result.ok).toBe(true);
  expect(log.some((l) => l.startsWith("smelt"))).toBe(false);
  expect(log.some((l) => l.startsWith("craft furnace"))).toBe(false);
});

test("diamonds take the whole tree: stone pickaxe for iron, a furnace for ingots, an iron pickaxe for diamonds", async () => {
  trees = 30;
  const result = await acquire("diamond", 1, world);
  expect(result.ok).toBe(true); // the sources throw if a step is skipped
  const at = (what: string) => log.findIndex((l) => l.startsWith(what));
  expect(at("craft stone_pickaxe")).toBeLessThan(at("mine raw_iron"));
  expect(at("mine raw_iron")).toBeLessThan(at("smelt iron_ingot"));
  expect(at("craft iron_pickaxe")).toBeLessThan(at("mine diamond"));
});
