// Path: src/managers/migrate.ts
// Brings an old db.json up to schema v2, as a pure function (tested on its own):
// - v1 kept the base, its basement, crafting tables, furnaces and mines under
//   "baseLocation", and chests in two places; v2 keeps points of interest in
//   memory.places and every chest in the chest index (memory.chests), a chest
//   never opened with contents null
// - the persisted command queue and the stale inventory snapshot are dropped
//   (commands never survive a restart; the inventory is read live)
// Everything else (lore, progress, memory) is kept as it is.

export const DB_VERSION = 2;

type Pos = { x: number; y: number; z: number };
type ChestEntry = Pos & { dimension: string; contents: Record<string, number> | null; seenAt: number };
type PlaceEntry = Pos & { kind: string; dimension: string; at: number; name?: string; details?: Record<string, unknown> };
/** The fields of a v1 (or v2) db.json this migration reads; anything else is kept as it is. */
type DbFile = {
  version?: unknown;
  memory?: { places?: PlaceEntry[]; chests?: ChestEntry[]; [key: string]: unknown };
  baseLocation?: {
    baseName?: unknown;
    location?: unknown;
    basementLocation?: unknown;
    craftTable?: unknown[];
    furnace?: unknown[];
    mines?: { name?: unknown; direction?: unknown; depth?: unknown; startsAt?: unknown; endsAt?: unknown }[];
    chests?: { location?: unknown; items?: { name: string; count: number }[] }[];
  };
  commands?: unknown;
  inventory?: unknown;
  [key: string]: unknown;
};
const isPos = (p: unknown): p is Pos =>
  typeof p === "object" && p !== null && ["x", "y", "z"].every((k) => typeof (p as Record<string, unknown>)[k] === "number");

/** Returns the data at the current version, and whether anything changed. */
export function migrate(raw: unknown, now = Date.now()): { data: DbFile; changed: boolean } {
  const data: DbFile = typeof raw === "object" && raw !== null ? { ...(raw as DbFile) } : {};
  if (data.version === DB_VERSION) return { data, changed: false };

  const memory = { ...(data.memory ?? {}) };
  const places: PlaceEntry[] = Array.isArray(memory.places) ? [...memory.places] : [];
  const chests: ChestEntry[] = Array.isArray(memory.chests) ? [...memory.chests] : [];
  const dimension = "overworld"; // v1 never stored one; its places were all overworld
  const place = (kind: string, p: unknown, extra: Partial<PlaceEntry> = {}): void => {
    if (isPos(p)) places.push({ kind, x: p.x, y: p.y, z: p.z, dimension, at: now, ...extra });
  };

  const base = data.baseLocation;
  if (base) {
    place("base", base.location, typeof base.baseName === "string" ? { name: base.baseName } : {});
    place("basement", base.basementLocation);
    for (const p of base.craftTable ?? []) place("crafting_table", p);
    for (const p of base.furnace ?? []) place("furnace", p);
    for (const m of base.mines ?? []) {
      place("mine", m.startsAt, {
        ...(typeof m.name === "string" ? { name: m.name } : {}),
        details: { direction: m.direction, depth: m.depth, endsAt: m.endsAt },
      });
    }
    // The old chest list: merged into the chest index (never opened: contents unknown)
    for (const c of base.chests ?? []) {
      const at = c.location;
      if (!isPos(at) || chests.some((k) => k.x === at.x && k.y === at.y && k.z === at.z)) continue;
      const items = Array.isArray(c.items) ? c.items : [];
      const contents = items.length > 0 ? Object.fromEntries(items.map((i) => [i.name, i.count])) : null;
      chests.push({ x: at.x, y: at.y, z: at.z, dimension, contents, seenAt: items.length > 0 ? now : 0 });
    }
    delete data.baseLocation;
  }

  delete data.commands; // owner commands never survive a restart
  delete data.inventory; // read live from the game
  memory.places = places;
  memory.chests = chests;
  data.memory = memory;
  data.version = DB_VERSION;
  return { data, changed: true };
}
