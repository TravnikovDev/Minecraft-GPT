// A full inventory handled like a player: with no chest around it makes one
// (junk thrown away, a stack of cobblestone set down for a moment to have
// room to craft), places it, and puts the less valuable stuff in it, keeping
// gear, food and valuables.
import { EventEmitter } from "node:events";
import { beforeEach, expect, mock, test } from "bun:test";
import { arriveAt, useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const Block = require(`${ROOT}/node_modules/prismarine-block`)(registry);
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);

type It = { name: string; count: number; type: number; stackSize: number };
const item = (name: string, count: number): It => ({ name, count, type: registry.itemsByName[name].id, stackSize: registry.itemsByName[name].stackSize });
let inv: It[] = [];
let chestItems: It[] = [];
let chestAt: any = null;
const said: string[] = [];
let nextEntity = 100;

// Crafting and placing as the game does them
const crafting = await import(`${ROOT}/src/actions/crafting.ts`);
mock.module(`${ROOT}/src/actions/crafting.ts`, () => ({
  ...crafting,
  craftRecipe: async (name: string, n: number) => {
    if (inv.length >= 36) return false; // nowhere for the result to go
    const take = (what: string, k: number) => {
      const s = inv.find((i) => i.name === what);
      if (!s || s.count < k) throw new Error(`no ${what}`);
      s.count -= k;
      inv = inv.filter((i) => i.count > 0);
    };
    if (name === "oak_planks") {
      const crafts = Math.ceil(n / 4);
      take("oak_log", crafts);
      inv.push(item("oak_planks", crafts * 4));
      return true;
    }
    if (name === "chest") {
      take("oak_planks", 8);
      inv.push(item("chest", 1));
      return true;
    }
    return false;
  },
}));
const placement = await import(`${ROOT}/src/actions/placement.ts`);
mock.module(`${ROOT}/src/actions/placement.ts`, () => ({
  ...placement,
  placeChestOutOfTheWay: async (name = "chest") => {
    inv = inv.filter((i) => i.name !== name);
    chestAt = new Vec3(3, 64, 0);
    return fake.blockAt(chestAt);
  },
}));

const fake: any = Object.assign(new EventEmitter(), {
  registry,
  version: "1.20.4",
  username: "MinecraftGPT",
  game: { dimension: "overworld" },
  entity: { position: new Vec3(0.5, 64, 0.5) },
  entities: {} as Record<number, any>,
  players: { Travnikov: { username: "Travnikov", entity: null } },
  vehicle: null,
  chat: (m: string) => said.push(m),
  whisper: (_: string, m: string) => said.push(m),
  inventory: { items: () => inv, emptySlotCount: () => 36 - inv.length },
  blockAt: (p: any) => {
    const isChest = chestAt && p.x === chestAt.x && p.y === chestAt.y && p.z === chestAt.z;
    const b = Block.fromStateId(registry.blocksByName[isChest ? "chest" : p.y < 64 ? "grass_block" : "air"].defaultState, 0);
    b.position = new Vec3(p.x, p.y, p.z);
    return b;
  },
  findBlock: () => (chestAt ? fake.blockAt(chestAt) : null),
  // Tossing: the stack leaves the inventory and lands as an item entity in front
  toss: async (type: number, _m: unknown, count: number) => {
    const s = inv.find((i) => i.type === type)!;
    const dropped = { ...s, count };
    s.count -= count;
    inv = inv.filter((i) => i.count > 0);
    const e = { id: nextEntity++, name: "item", onGround: true, position: new Vec3(2, 64, 0), getDroppedItem: () => dropped };
    fake.entities[e.id] = e;
    fake.emit("entitySpawn", e);
  },
  openContainer: async () => ({
    inventoryStart: 27,
    containerItems: () => chestItems,
    close: () => {},
    deposit: async (type: number, _m: unknown, count: number) => {
      const s = inv.find((i) => i.type === type)!;
      s.count -= count;
      inv = inv.filter((i) => i.count > 0);
      chestItems.push({ ...s, count });
    },
  }),
  pathfinder: {
    goal: null,
    isMoving: () => false,
    setGoal: () => {},
    // Walking up to an item picks it up
    goto: async (g: any) => {
      arriveAt(fake, g);
      for (const e of Object.values(fake.entities as Record<number, any>)) {
        if (Math.abs(e.position.x - g.x) < 1 && Math.abs(e.position.z - g.z) < 1) {
          inv.push(e.getDroppedItem());
          delete fake.entities[e.id];
        }
      }
    },
  },
});
useFakeBot(fake);
beforeEach(() => {
  useFakeBot(fake);
  chestItems = [];
  chestAt = null;
  said.length = 0;
  fake.entities = {};
});
const { makeRoom } = await import(`${ROOT}/src/actions/overflow.ts`);
const { chooseToStore, itemValue, ROOM_SLOTS } = await import(`${ROOT}/src/actions/storage.ts`);

test("less valuable means junk, bulk and ordinary materials; gems, ingots and gear stay", () => {
  expect(itemValue("rotten_flesh")).toBe(0);
  expect(itemValue("cobblestone")).toBe(1);
  expect(itemValue("coal")).toBe(2);
  expect(itemValue("diamond")).toBe(3);
  expect(itemValue("iron_ingot")).toBe(3);
  // A single cobblestone stays now (up to 32 is kept for building); leather goes
  const stacks = ["cobblestone", "leather", "diamond", "iron_ingot", "iron_pickaxe", "bread", "torch"].map((n) => item(n, 1));
  expect(chooseToStore(stacks, "lowValue").map((d: any) => d.stack.name)).toEqual(["leather"]);
});

test("a working supply of coal, sticks, logs and building stone stays, and so does what the job is collecting", () => {
  const stacks = [item("coal", 64), item("coal", 12), item("oak_log", 5), item("stick", 3), item("raw_iron", 17), item("cobblestone", 64)];
  const plan = chooseToStore(stacks, "lowValue", [], ["iron_ore", "raw_iron"]).map((d: any) => [d.stack.name, d.count]);
  // 16 coal kept (out of 76): 48 from the first stack, all 12 of the second;
  // 32 cobblestone kept for building and patching
  expect(plan).toEqual([["coal", 48], ["coal", 12], ["cobblestone", 32]]);
});

test("full with no chest: it makes one, places it and fills it with the cheap stuff", async () => {
  inv = [
    item("rotten_flesh", 5),
    item("oak_log", 2),
    item("diamond", 3),
    item("iron_pickaxe", 1),
    item("bread", 6),
    ...Array.from({ length: 11 }, () => item("iron_ingot", 64)), // valuables: kept
    ...Array.from({ length: 20 }, () => item("cobblestone", 64)), // a chest holds 27 stacks; these fit
  ];
  expect(inv.length).toBe(36);
  expect(await makeRoom("pick up the logs")).toBe(true);

  expect(chestAt).not.toBeNull(); // a chest was made and placed
  const stored = new Set(chestItems.map((i) => i.name));
  expect(stored.has("cobblestone")).toBe(true);
  expect(chestItems.filter((i) => i.name === "cobblestone").length).toBe(20); // incl. the stack it set down and picked back up
  expect([...new Set(inv.map((i) => i.name))].sort()).toEqual(["bread", "diamond", "iron_ingot", "iron_pickaxe"]); // kept
  expect(inv.some((i) => i.name === "rotten_flesh")).toBe(false); // junk out of the inventory (thrown, or swept into the chest)
  expect(said.some((m) => m.includes("new chest at 3, 64, 0"))).toBe(true);
});

test("full and nothing to make a chest from: it says what it needs, and picks back up what it set down", async () => {
  inv = Array.from({ length: 36 }, () => item("cobblestone", 64));
  expect(await makeRoom("pick up the logs")).toBe(false);
  expect(chestAt).toBeNull();
  expect(Object.keys(fake.entities)).toEqual([]); // nothing left lying around
  expect(said.some((m) => m.includes("couldn't make a chest"))).toBe(true);
});

test("making room puts away only the cheapest few stacks, about a tenth of the inventory", () => {
  const stacks = [
    item("cobblestone", 64), item("cobblestone", 64), item("cobblestone", 30),
    item("wheat_seeds", 30), item("dirt", 16), item("leather", 18), item("raw_copper", 17),
    item("coal", 64), item("oak_log", 23), item("white_wool", 8), item("string", 3),
    item("diamond", 5), item("bread", 6), item("iron_pickaxe", 1),
  ];
  const plan = chooseToStore(stacks, "room").map((d: any) => [d.stack.name, d.count]);
  // The pile of cobblestone but 16 (kept for tunnel floors and plugs: one
  // stack stays, partly), then the next-cheapest bulk: 4 slots freed
  expect(plan).toEqual([["cobblestone", 64], ["cobblestone", 30], ["wheat_seeds", 30], ["dirt", 16]]);
  expect(plan.length).toBeGreaterThanOrEqual(ROOM_SLOTS);
  // Materials, the coal and logs it works with, gems, food and gear all stay
  expect(plan.some(([n]: any) => ["leather", "raw_copper", "coal", "oak_log", "diamond", "bread"].includes(n))).toBe(false);
});

test("only mineral blocks count as precious; hay and bone blocks are ordinary", () => {
  expect(itemValue("iron_block")).toBe(3);
  expect(itemValue("diamond_block")).toBe(3);
  expect(itemValue("hay_block")).toBe(2);
  expect(itemValue("bone_block")).toBe(2);
  expect(itemValue("dripstone_block")).toBe(1);
});
