// Using chests like a player: what gets stored for each request, putting
// things in and taking them out of a (fake) chest, and placing a chest next
// to the bed rather than "somewhere near the bot".
import { beforeEach, expect, test } from "bun:test";
import { arriveAt, useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const Block = require(`${ROOT}/node_modules/prismarine-block`)(registry);
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);

// --- A fake chest and inventory with real slot limits --------------------------
type It = { name: string; count: number; type: number; stackSize: number; nbt?: unknown };
const item = (name: string, count: number, nbt?: unknown): It => ({
  name,
  count,
  type: registry.itemsByName[name].id,
  stackSize: registry.itemsByName[name].stackSize,
  nbt,
});
let inv: It[] = [];
let chestItems: It[] = [];
let chestSlots = 27;
const INV_SLOTS = 36;
const chestPos = new Vec3(3, 64, 0);
function move(from: It[], to: It[], toSlots: number, type: number, count: number, nbt?: unknown) {
  let left = count;
  for (const src of from.filter((i) => i.type === type && (nbt === undefined || JSON.stringify(i.nbt) === JSON.stringify(nbt)))) {
    while (left > 0 && src.count > 0) {
      const room = to.find((i) => i.type === type && i.count < i.stackSize && i.stackSize > 1);
      if (!room && to.length >= toSlots) throw new Error("destination full");
      const target = room ?? (to.push({ ...src, count: 0 }), to[to.length - 1]);
      const n = Math.min(left, src.count, target.stackSize - target.count);
      target.count += n;
      src.count -= n;
      left -= n;
    }
  }
  from.splice(0, from.length, ...from.filter((i) => i.count > 0));
}
const fake: any = {
  registry,
  version: "1.20.4",
  game: { dimension: "overworld" },
  entity: { position: new Vec3(0.5, 64, 0.5) },
  entities: {},
  players: {},
  vehicle: null,
  inventory: { items: () => inv, emptySlotCount: () => INV_SLOTS - inv.length },
  blockAt: (p: any) => {
    const name = p.x === chestPos.x && p.y === chestPos.y && p.z === chestPos.z ? "chest" : p.y < 64 ? "grass_block" : "air";
    const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
    b.position = new Vec3(p.x, p.y, p.z);
    return b;
  },
  findBlock: () => fake.blockAt(chestPos),
  findBlocks: () => [chestPos],
  openContainer: async () => ({
    inventoryStart: chestSlots,
    containerItems: () => chestItems,
    close: () => {},
    deposit: async (type: number, _m: unknown, count: number, nbt?: unknown) => move(inv, chestItems, chestSlots, type, count, nbt),
    withdraw: async (type: number, _m: unknown, count: number, nbt?: unknown) => move(chestItems, inv, INV_SLOTS, type, count, nbt),
  }),
  pathfinder: { goal: null, isMoving: () => false, setGoal: () => {}, goto: async (g: any) => arriveAt(fake, g) },
};
useFakeBot(fake);
beforeEach(() => {
  useFakeBot(fake);
  chestItems = [];
  chestSlots = 27;
});
const storage = await import(`${ROOT}/src/actions/storage.ts`);
const { spotsNear } = await import(`${ROOT}/src/actions/placement.ts`);
const names = (plan: any[]) => plan.map((d) => `${d.count} ${d.stack.name}`);

// --- What to store ----------------------------------------------------------------
const kit = () => [
  item("cobblestone", 64),
  item("cobblestone", 20),
  item("raw_iron", 15),
  item("iron_pickaxe", 1),
  item("stone_pickaxe", 1),
  item("diamond_sword", 1),
  item("iron_sword", 1),
  item("bow", 1, { a: 1 }),
  item("bow", 1, { a: 2 }),
  item("cooked_porkchop", 8),
  item("torch", 12),
  item("crafting_table", 1),
  item("white_bed", 1),
  item("spider_eye", 2),
];

test("resources: materials go, gear, food, torches, bed and crafting table stay", () => {
  expect(names(storage.chooseToStore(kit(), "resources"))).toEqual(["64 cobblestone", "20 cobblestone", "15 raw_iron", "2 spider_eye"]);
});

test("duplicates: the best tool and weapon of each kind stay, extra copies and smaller stacks go", () => {
  expect(names(storage.chooseToStore(kit(), "duplicates"))).toEqual(["20 cobblestone", "1 stone_pickaxe", "1 iron_sword", "1 bow"]);
});

test("named items, with or without a count, and categories", () => {
  expect(names(storage.chooseToStore(kit(), "items", [{ name: "cobblestone", count: 70 }]))).toEqual(["64 cobblestone", "6 cobblestone"]);
  expect(names(storage.chooseToStore(kit(), "items", [{ name: "raw_iron", count: null }]))).toEqual(["15 raw_iron"]);
  expect(names(storage.chooseToStore(kit(), "items", [{ name: "pickaxe", count: null }]))).toEqual(["1 iron_pickaxe", "1 stone_pickaxe"]);
});

// --- Putting away and taking out ---------------------------------------------------------
test("store resources: they end up in the chest, the kit stays with the bot", async () => {
  inv = kit();
  const result = await storage.storeItems("resources");
  expect(Object.fromEntries(result.stored)).toEqual({ cobblestone: 84, raw_iron: 15, spider_eye: 2 });
  expect(Object.fromEntries(storage.tally(chestItems))).toEqual({ cobblestone: 84, raw_iron: 15, spider_eye: 2 });
  expect(inv.some((i) => i.name === "cobblestone")).toBe(false);
  expect(inv.some((i) => i.name === "iron_pickaxe")).toBe(true);
});

test("store duplicates keeps exactly the better bow (by its own NBT)", async () => {
  inv = [item("bow", 1, { a: 1 }), item("bow", 1, { a: 2 })];
  await storage.storeItems("duplicates");
  expect(inv.length).toBe(1);
  expect(chestItems.length).toBe(1);
  expect(inv[0].nbt).not.toEqual(chestItems[0].nbt);
});

test("a full chest: what didn't fit is reported, nothing is lost", async () => {
  inv = [item("dirt", 64), item("gravel", 10)];
  chestSlots = 1;
  const result = await storage.storeItems("all");
  expect(Object.fromEntries(result.stored)).toEqual({ dirt: 64 });
  expect(Object.fromEntries(result.leftOver)).toEqual({ gravel: 10 });
  expect(inv.find((i) => i.name === "gravel")?.count).toBe(10);
});

test("take named items out, and say what isn't there", async () => {
  inv = [];
  chestItems = [item("iron_ingot", 20), item("coal", 10)];
  const result = await storage.takeItems([{ name: "iron_ingot", count: 5 }, { name: "diamond", count: null }]);
  expect(Object.fromEntries(result.taken)).toEqual({ iron_ingot: 5 });
  expect(result.missing).toEqual(["diamond"]);
  expect(storage.tally(chestItems).get("iron_ingot")).toBe(15);
});

// --- Placing next to the bed ---------------------------------------------------------------
test("a chest placed near the bed touches the bed, never sits on it or where the owner stands", () => {
  const bed = [new Vec3(0, 64, 0), new Vec3(1, 64, 0)];
  const owner = new Vec3(0, 64, 1);
  const spots = spotsNear(bed, (p: any) => fake.blockAt(p), 1, [owner]);
  const first = spots[0];
  const touches = bed.some((b) => Math.abs(b.x - first.x) + Math.abs(b.z - first.z) === 1 && b.y === first.y);
  expect(touches).toBe(true);
  expect(spots.some((s: any) => bed.some((b) => b.equals(s)) || s.equals(owner))).toBe(false);
});

test("a full chest: the rest goes in its next chest (owner: stuck with one chest though it has 3)", async () => {
  const { updateMemory } = await import(`${ROOT}/src/managers/persistenceManager.ts`);
  const second = new Vec3(8, 64, 0);
  const secondItems: It[] = [];
  const saved = { blockAt: fake.blockAt, openContainer: fake.openContainer, findBlocks: fake.findBlocks };
  const isChest = (p: any) => [chestPos, second].some((c) => c.x === p.x && c.y === p.y && c.z === p.z);
  fake.blockAt = (p: any) => {
    const b = Block.fromStateId(registry.blocksByName[isChest(p) ? "chest" : p.y < 64 ? "grass_block" : "air"].defaultState, 0);
    b.position = new Vec3(p.x, p.y, p.z);
    return b;
  };
  fake.findBlocks = () => [chestPos, second];
  fake.openContainer = async (block: any) => {
    const items = block.position.x === second.x ? secondItems : chestItems;
    const slots = block.position.x === second.x ? 27 : chestSlots;
    return {
      inventoryStart: slots,
      containerItems: () => items,
      close: () => {},
      deposit: async (type: number, _m: unknown, count: number, nbt?: unknown) => move(inv, items, slots, type, count, nbt),
      withdraw: async (type: number, _m: unknown, count: number, nbt?: unknown) => move(items, inv, INV_SLOTS, type, count, nbt),
    };
  };
  try {
    // Both remembered, the nearer one full (its last trip)
    await updateMemory({ chests: [] });
    inv = [item("cobblestone", 64), item("cobblestone", 64), item("granite", 30)];
    chestSlots = 1;
    const result = await storage.storeItems("all");
    expect(Object.fromEntries(result.stored)).toEqual({ cobblestone: 128, granite: 30 });
    expect(result.leftOver.size).toBe(0);
    expect(Object.fromEntries(storage.tally(secondItems))).toEqual({ cobblestone: 64, granite: 30 });
    expect(inv.length).toBe(0);
  } finally {
    Object.assign(fake, saved);
  }
});

test("a double chest's two halves are one chest", () => {
  expect(storage.sameChest({ x: -23, y: 68, z: 22 }, { x: -24, y: 68, z: 22 })).toBe(true);
  expect(storage.sameChest({ x: -23, y: 68, z: 22 }, { x: -23, y: 68, z: 20 })).toBe(false);
  expect(storage.sameChest({ x: -23, y: 68, z: 22 }, { x: -23, y: 69, z: 22 })).toBe(false);
});
