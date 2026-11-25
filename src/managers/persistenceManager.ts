// Path: src/managers/persistenceManager.ts
// What the bot remembers across restarts, one file per world:
// worlds/<world id>.json next to db.json. The world id is the hashed seed the
// server sends at login (the same for a world across restarts and LAN ports;
// two worlds made from the same seed share it). Until the bot has logged in
// there is no world, and nothing is saved. The single db.json from before
// memory was kept per world is left alone.
//
// Each world file (schema v2, see
// managers/migrate.ts). Points of interest (base, crafting tables, furnaces,
// mines) live in memory.places, chests in the chest index (memory.chests),
// plus the death spot, the owner's last position, its bed, the recent
// conversation and the areas it must keep out of. The old getter and setter
// names are kept as adapters over memory.places.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { dirname, join, resolve } from "path";
import { z } from "zod";
import type { DbSchemaType, MemoryType, MineType, PositionType } from "../schemas/types";
import { BotProgressSchema, DbSchema, LoreSchema, MemorySchema, PositionSchema } from "../schemas/mainSchemas";
import type { DirectionType } from "../actions/digging";
import { DB_VERSION, migrate } from "./migrate";

// DB_PATH lets tests use a throwaway file instead of the bot's real memory
const legacyPath = resolve(process.env["DB_PATH"] ?? "db.json");
const worldsDir = join(dirname(legacyPath), "worlds");
let dbPath = legacyPath;
let currentWorld: string | null = null;
// Saving starts once a file is loaded (a world's, or the test file)
let loaded = false;
const freshDb = (path: string): Low<DbSchemaType> =>
  new Low<DbSchemaType>(new JSONFile<DbSchemaType>(path), {
    version: DB_VERSION,
    lore: { events: [] },
    botProgress: { currentLevel: 1, craftableTier: 1, unlockedRecipes: [] },
  });
let db = freshDb(dbPath);

/** The world id from the login packet's hashed seed (64 bits, as protodef gives them: [high, low] or a bigint). */
export function worldIdFrom(hashedSeed: unknown): string | null {
  try {
    const v = Array.isArray(hashedSeed)
      ? (BigInt((hashedSeed[0] as number) >>> 0) << 32n) | BigInt((hashedSeed[1] as number) >>> 0)
      : BigInt(hashedSeed as bigint | number | string);
    return BigInt.asUintN(64, v).toString(16).padStart(16, "0");
  } catch {
    return null;
  }
}

/** The world whose memory is loaded (null before the first login). */
export function currentWorldId(): string | null {
  return currentWorld;
}

/** Switches memory to this world's file (loading it, or starting empty). */
export async function useWorld(id: string): Promise<void> {
  if (id === currentWorld) return;
  currentWorld = id;
  mkdirSync(worldsDir, { recursive: true });
  dbPath = join(worldsDir, `${id}.json`);
  const known = existsSync(dbPath);
  db = freshDb(dbPath);
  await loadDb();
  console.log(`Memory: world ${id} (${known ? "remembered" : "new"}, ${dbPath}).`);
}

/**
 * Loads db.json, bringing an older one up to v2 (a copy of the old file is
 * kept as db.json.v1.bak). A file that doesn't validate is set aside and the
 * bot starts with empty memory, so saving never silently stops.
 */
export async function loadDb(): Promise<void> {
  loaded = true;
  let raw: unknown = db.data;
  if (existsSync(dbPath)) {
    try {
      raw = JSON.parse(readFileSync(dbPath, "utf8"));
    } catch (error) {
      // Not JSON (a hand edit with a typo): keep it aside, never write over it
      const aside = `${dbPath}.unreadable-${Date.now()}`;
      copyFileSync(dbPath, aside);
      console.error(`Memory: db.json isn't valid JSON (${(error as Error).message}); kept as ${aside}, starting with empty memory.`);
      raw = { version: DB_VERSION, lore: { events: [] } };
    }
  }
  try {
    const { data, changed } = migrate(raw);
    if (changed && existsSync(dbPath)) {
      const backup = `${dbPath}.v1.bak`;
      if (!existsSync(backup)) copyFileSync(dbPath, backup);
      console.log(`Memory: db.json upgraded to schema v${DB_VERSION} (old file kept as ${backup}).`);
    }
    const parsed = DbSchema.safeParse(data);
    if (parsed.success) {
      db.data = parsed.data;
    } else {
      // One bad entry must not cost the whole memory: keep what's valid
      const aside = `${dbPath}.invalid-${Date.now()}`;
      if (existsSync(dbPath)) copyFileSync(dbPath, aside);
      db.data = salvage(data);
      console.error(`Memory: some of db.json didn't validate; kept the rest (the whole file is in ${aside}).`, parsed.error.issues.slice(0, 5));
    }
    await db.write();
  } catch (error) {
    console.error("Error loading database:", error);
  }
}

/** Keeps every memory field (and every list entry) that validates, dropping only the bad ones. */
export function salvage(data: Record<string, unknown>): DbSchemaType {
  const memoryIn = (data["memory"] ?? {}) as Record<string, unknown>;
  const memory: Record<string, unknown> = {};
  const shape = MemorySchema.shape as Record<string, z.ZodTypeAny>;
  for (const [key, value] of Object.entries(memoryIn)) {
    const field = shape[key];
    if (!field) {
      memory[key] = value; // unknown to this version: kept as it is
      continue;
    }
    if (field.safeParse(value).success) {
      memory[key] = value;
      continue;
    }
    // A list with a bad entry: keep the good entries
    const inner = field instanceof z.ZodOptional ? field.unwrap() : field;
    if (Array.isArray(value) && inner instanceof z.ZodArray) {
      memory[key] = value.filter((entry) => (inner.element as unknown as z.ZodType).safeParse(entry).success);
    }
  }
  const out: Record<string, unknown> = { ...data, version: DB_VERSION, memory };
  const lore = LoreSchema.safeParse(data["lore"]);
  out["lore"] = lore.success ? lore.data : { events: [] };
  if (data["botProgress"] !== undefined && !BotProgressSchema.safeParse(data["botProgress"]).success) delete out["botProgress"];
  const parsed = DbSchema.safeParse(out);
  return parsed.success ? parsed.data : { version: DB_VERSION, lore: { events: [] } };
}

/** Saves db.json. A validation failure is a bug: it is logged loudly every time. */
export async function saveDb(): Promise<void> {
  if (!loaded) return; // no world yet: nothing to save it under
  try {
    const parsed = DbSchema.safeParse(db.data);
    if (!parsed.success) {
      console.error("Memory NOT saved: it doesn't validate (a bug).", parsed.error.issues.slice(0, 5));
      return;
    }
    await db.write();
  } catch (error) {
    console.error("Error saving to database:", error);
  }
}

/** Kept for callers from before schema v2: commands are no longer stored (they never survive a restart). */
export async function removeAllCommands(): Promise<void> {}

// --- Session memory (survives restarts) --------------------------------------

/** The persisted session memory. */
export function getMemory(): MemoryType {
  return db.data?.memory ?? {};
}

/** Merges fields into the persisted session memory and saves. */
export async function updateMemory(patch: Partial<MemoryType>): Promise<void> {
  if (!db.data) return;
  db.data.memory = { ...(db.data.memory ?? {}), ...patch };
  await saveDb();
}

// --- Points of interest (memory.places) ----------------------------------------

export type Place = NonNullable<MemoryType["places"]>[number];
type PlaceKind = Place["kind"];
const OVERWORLD = "overworld";

/** Every remembered place of a kind, newest last. */
export function getPlaces(kind?: PlaceKind): Place[] {
  const all = getMemory().places ?? [];
  return kind ? all.filter((p) => p.kind === kind) : all;
}

/** Remembers a place (replacing one of the same kind at the same spot). */
export async function addPlace(place: Omit<Place, "at" | "dimension"> & { dimension?: string }): Promise<void> {
  const others = getPlaces().filter((p) => !(p.kind === place.kind && p.x === place.x && p.y === place.y && p.z === place.z));
  await updateMemory({ places: [...others, { dimension: OVERWORLD, ...place, at: Date.now() }] });
}

/** Forgets places matching `which` (a table that was broken). Returns how many. */
export async function forgetPlaces(which: (p: Place) => boolean): Promise<number> {
  const all = getPlaces();
  const kept = all.filter((p) => !which(p));
  if (kept.length !== all.length) await updateMemory({ places: kept });
  return all.length - kept.length;
}

const pos = (p: Place): PositionType => ({ x: p.x, y: p.y, z: p.z });

/** Sets the base (one base; the old one is replaced). */
export async function saveBaseLocation(baseName = "base", location: PositionType): Promise<void> {
  const parsed = PositionSchema.safeParse(location);
  if (!parsed.success) return;
  await forgetPlaces((p) => p.kind === "base");
  await addPlace({ kind: "base", name: baseName, ...parsed.data });
}

export async function saveBasementLocation(location: PositionType): Promise<void> {
  await forgetPlaces((p) => p.kind === "basement");
  await addPlace({ kind: "basement", ...location });
}

export async function saveCraftingTableLocation(position: PositionType): Promise<void> {
  await addPlace({ kind: "crafting_table", ...position });
}

export async function saveFurnaceLocation(position: PositionType): Promise<void> {
  await addPlace({ kind: "furnace", ...position });
}

/** A chest it placed: in the chest index, contents unknown until it looks inside. */
export async function saveChestLocation(position: PositionType): Promise<void> {
  const chests = getMemory().chests ?? [];
  if (chests.some((c) => c.x === position.x && c.y === position.y && c.z === position.z)) return;
  await updateMemory({ chests: [...chests, { ...position, dimension: OVERWORLD, contents: null, seenAt: 0 }] });
}

export async function saveMineLocation(mine: {
  name: string;
  direction: DirectionType;
  startsAt: PositionType;
  endsAt: PositionType;
  depth: number;
}): Promise<void> {
  await addPlace({
    kind: "mine",
    name: mine.name,
    ...mine.startsAt,
    details: { direction: mine.direction, depth: mine.depth, endsAt: mine.endsAt },
  });
}

export function getBaseLocation(): PositionType | undefined {
  const base = getPlaces("base").at(-1);
  return base ? pos(base) : undefined;
}

export function getBasementLocation(): PositionType | undefined {
  const basement = getPlaces("basement").at(-1);
  return basement ? pos(basement) : undefined;
}

export function getCraftingTables(): PositionType[] {
  return getPlaces("crafting_table").map(pos);
}

export function getFurnaces(): PositionType[] {
  return getPlaces("furnace").map(pos);
}

/** Chests it knows in a dimension, most recently checked first, as positions (contents: core/session). */
export function getChests(dimension = OVERWORLD): { location: PositionType }[] {
  return (getMemory().chests ?? [])
    .filter((c) => c.dimension === dimension)
    .sort((a, b) => b.seenAt - a.seenAt)
    .map((c) => ({ location: { x: c.x, y: c.y, z: c.z } }));
}

export function getMines(): MineType[] {
  return getPlaces("mine").map((m) => {
    const d = (m.details ?? {}) as { direction?: DirectionType; depth?: number; endsAt?: PositionType };
    return {
      name: m.name ?? "mine",
      direction: d.direction ?? "north",
      startsAt: pos(m),
      endsAt: d.endsAt ?? pos(m),
      depth: d.depth ?? 0,
    };
  });
}
