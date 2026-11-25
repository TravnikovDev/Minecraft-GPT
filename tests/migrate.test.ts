// Phase 5: db.json schema v2. An old file keeps everything worth keeping
// (base, basement, tables, furnaces, mines, chests, bed, death spot), drops
// the persisted command queue and the stale inventory snapshot, keeps fields
// it doesn't know, and a copy of the old file is set aside first.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const { migrate, DB_VERSION } = await import(`${ROOT}/src/managers/migrate.ts`);

const v1 = {
  commands: [{ id: "a", command: "craftStoneTools", priority: 3, retryCount: 0 }],
  inventory: [{ name: "dirt", count: 5 }],
  lore: { events: ["Found a village"] },
  botProgress: { currentLevel: 2, craftableTier: 2, unlockedRecipes: ["stick"] },
  futureField: { keep: true },
  memory: {
    bed: { x: 514, y: 79, z: -1140, dimension: "overworld", at: 1 },
    chests: [{ x: 548, y: 53, z: -1315, dimension: "overworld", contents: { coal: 16 }, seenAt: 5 }],
  },
  baseLocation: {
    baseName: "home",
    location: { x: 10, y: 64, z: 10 },
    basementLocation: { x: 10, y: 50, z: 10 },
    craftTable: [{ x: 11, y: 64, z: 10 }],
    furnace: [{ x: 12, y: 64, z: 10 }],
    chests: [
      { type: "Miscellaneous", location: { x: 13, y: 64, z: 10 }, items: [] },
      { type: "Food", location: { x: 14, y: 64, z: 10 }, items: [{ name: "bread", count: 3 }] },
      { type: "Miscellaneous", location: { x: 548, y: 53, z: -1315 }, items: [] }, // already in the index
    ],
    mines: [{ name: "iron mine", direction: "north", startsAt: { x: 20, y: 60, z: 0 }, endsAt: { x: 20, y: 40, z: -20 }, depth: 20 }],
  },
};

test("an old db.json becomes v2: places, one chest index, no command queue or inventory snapshot", () => {
  const { data, changed } = migrate(structuredClone(v1), 1000);
  expect(changed).toBe(true);
  expect(data.version).toBe(DB_VERSION);
  expect(data.commands).toBeUndefined();
  expect(data.inventory).toBeUndefined();
  expect(data.baseLocation).toBeUndefined();
  expect(data.lore).toEqual(v1.lore);
  expect(data.botProgress).toEqual(v1.botProgress);
  expect(data.futureField).toEqual({ keep: true }); // fields it doesn't know are kept
  expect(data.memory.bed).toEqual(v1.memory.bed);
  const places = data.memory.places.map((p: any) => `${p.kind}${p.name ? ` ${p.name}` : ""} ${p.x},${p.y},${p.z}`);
  expect(places).toEqual(["base home 10,64,10", "basement 10,50,10", "crafting_table 11,64,10", "furnace 12,64,10", "mine iron mine 20,60,0"]);
  expect(data.memory.places.find((p: any) => p.kind === "mine").details).toEqual({ direction: "north", depth: 20, endsAt: { x: 20, y: 40, z: -20 } });
  const chests = data.memory.chests.map((c: any) => [`${c.x},${c.y},${c.z}`, c.contents]);
  expect(chests).toEqual([
    ["548,53,-1315", { coal: 16 }], // the one it had looked into keeps its contents
    ["13,64,10", null], // never opened: unknown, never "empty"
    ["14,64,10", { bread: 3 }],
  ]);
});

test("a v2 file is left alone", () => {
  const once = migrate(structuredClone(v1), 1000).data;
  const twice = migrate(structuredClone(once), 2000);
  expect(twice.changed).toBe(false);
  expect(twice.data).toEqual(once);
});

test("loading an old db.json keeps a copy of it and reads the places back", async () => {
  const path = process.env.DB_PATH!;
  writeFileSync(path, JSON.stringify(v1));
  const P = await import(`${ROOT}/src/managers/persistenceManager.ts`);
  await P.loadDb();
  expect(existsSync(`${path}.v1.bak`)).toBe(true);
  expect(JSON.parse(readFileSync(`${path}.v1.bak`, "utf8")).baseLocation.baseName).toBe("home");
  expect(P.getBaseLocation()).toEqual({ x: 10, y: 64, z: 10 });
  expect(P.getCraftingTables()).toEqual([{ x: 11, y: 64, z: 10 }]);
  expect(P.getMines()[0]).toMatchObject({ name: "iron mine", direction: "north", depth: 20 });
  const saved = JSON.parse(readFileSync(path, "utf8"));
  expect(saved.version).toBe(DB_VERSION);
  expect(saved.futureField).toEqual({ keep: true });
});

test("one bad entry costs only that entry, and an unreadable file is kept, never written over", async () => {
  const P = await import(`${ROOT}/src/managers/persistenceManager.ts`);
  const path = process.env.DB_PATH!;
  const v2 = migrate(structuredClone(v1), 1000).data;
  v2.memory.chests.push({ x: "oops" }); // a broken entry
  writeFileSync(path, JSON.stringify(v2));
  await P.loadDb();
  expect(P.getChests().length).toBe(3); // the good ones survive
  expect(P.getBaseLocation()).toEqual({ x: 10, y: 64, z: 10 });

  writeFileSync(path, '{"version": 2, "memory": {,}'); // a hand edit with a typo
  await P.loadDb();
  const { readdirSync } = await import("node:fs");
  const { dirname, basename } = await import("node:path");
  expect(readdirSync(dirname(path)).some((f: string) => f.startsWith(`${basename(path)}.unreadable-`))).toBe(true);
});
