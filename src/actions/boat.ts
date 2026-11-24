// Path: src/actions/boat.ts
// Boat travel: crossing water by boat instead of swimming (about 7 blocks a
// second against 2, and no drowning).
//
// mineflayer can place a boat and get in, but it cannot row: in Java Edition
// the client moves its own boat and tells the server where it is. So this
// module drives the boat itself, sending a small boat move each tick along a
// route planned over the water surface. The server checks every move, so the
// boat only goes at normal rowing speed and land stops it; when the server
// corrects the boat's position, the driver adopts the corrected one.

import type { Entity } from "prismarine-entity";
import type { Item } from "prismarine-item";
import pf from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { isCommandCancelled, trackCleanup } from "../core/commandContext";
import { pathing } from "../core/plugins";

/** Trips at least this long make the bot get a boat before it sets off. */
export const BOAT_TRIP_BLOCKS = 150;

const TICK_MS = 50;
const SPEED = 0.35; // blocks per tick, about 7 blocks a second (normal rowing)
const PLAN_BUDGET = 30_000; // water cells searched per route plan
const MAX_PLANS = 40; // re-plans per crossing as new chunks load
const STUCK_MS = 4000;
const AIR = new Set(["air", "cave_air", "void_air"]);

type Cell = { x: number; z: number };
type XZ = { x: number; z: number };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const distXZ = (a: XZ, b: XZ): number => Math.hypot(a.x - b.x, a.z - b.z);

async function tell(message: string): Promise<void> {
  const { tellOwner } = await import("../managers/ownerDialog");
  tellOwner(message);
}

// --- Boat items --------------------------------------------------------------

/** True when the bot is sitting in a boat. */
export function inBoat(): boolean {
  return /boat|raft/.test(bot.vehicle?.name ?? "");
}

/** A boat to travel with: one in the inventory or the one the bot sits in. */
export function hasBoat(): boolean {
  return inBoat() || boatItem() !== null;
}

/** A boat (or raft) in the inventory, if any. */
export function boatItem(): Item | null {
  return bot.inventory.items().find((i) => /_(boat|raft)$/.test(i.name)) ?? null;
}

/**
 * Makes sure the bot carries a boat: crafts one from what it has, gathering a
 * few logs first if that's all that's missing. Returns false if it couldn't.
 */
export async function ensureBoat(): Promise<boolean> {
  if (boatItem()) return true;
  const { craftNow, resolveCraftable } = await import("./craftPlanner");
  const pick = (): string => resolveCraftable("boat", 1) ?? "oak_boat";
  let result = await craftNow(pick(), 1);
  if (result.ok) return true;
  const onlyLogs = result.missing.length === 1 && result.missing[0]!.name === "logs";
  if (!onlyLogs || isCommandCancelled()) return false;
  const { gatherWood } = await import("./gatherWood");
  await gatherWood(Math.max(3, result.missing[0]!.count), 32);
  if (isCommandCancelled()) return false;
  result = await craftNow(pick(), 1);
  return result.ok && boatItem() !== null;
}

// --- The water surface -------------------------------------------------------

type CellState = "water" | "land" | "unknown";

/** Open water at height Y: water with air above (lily pads and ice block boats). */
function cellState(x: number, z: number, y: number): CellState {
  const block = bot.blockAt(new Vec3(x, y, z));
  const above = bot.blockAt(new Vec3(x, y + 1, z));
  if (!block || !above) return "unknown";
  return block.name === "water" && AIR.has(above.name) ? "water" : "land";
}

/** Height of the water surface in a column near height `aroundY`, or null. */
function surfaceAt(x: number, z: number, aroundY: number): number | null {
  for (let y = Math.floor(aroundY) + 3; y >= Math.floor(aroundY) - 8; y--) {
    const block = bot.blockAt(new Vec3(x, y, z));
    if (!block) return null;
    if (AIR.has(block.name)) continue;
    return block.name === "water" ? y : null;
  }
  return null;
}

/**
 * True when much of the way toward the target (the next ~30 blocks) is water,
 * starting close by, so a boat would be worth it.
 */
export function waterAhead(target: XZ): boolean {
  const pos = bot.entity.position;
  const d = distXZ(pos, target);
  if (d < 16) return false;
  const ux = (target.x - pos.x) / d;
  const uz = (target.z - pos.z) / d;
  let water = 0;
  let samples = 0;
  let firstWaterAt: number | null = null;
  for (let s = 3; s <= Math.min(30, d); s += 3) {
    const level = surfaceAt(Math.floor(pos.x + ux * s), Math.floor(pos.z + uz * s), pos.y);
    samples++;
    if (level !== null) {
      water++;
      firstWaterAt ??= s;
    }
  }
  return samples > 0 && water / samples >= 0.5 && firstWaterAt !== null && firstWaterAt <= 12;
}

// --- Route planning over water -------------------------------------------------

type Route = {
  cells: Cell[]; // from the start cell to the best cell
  best: Cell; // the reachable water cell closest to the target
  exhausted: boolean; // the whole body of water was searched (best is final)
};

/** A small binary heap keyed by f-score. */
class Heap {
  private items: Array<{ f: number; key: string }> = [];
  get size(): number {
    return this.items.length;
  }
  push(item: { f: number; key: string }): void {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.f <= a[i]!.f) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): { f: number; key: string } | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.f < a[m]!.f) m = l;
        if (r < a.length && a[r]!.f < a[m]!.f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * A* over open water cells at height y, toward the target. Cells next to land
 * cost more, so the boat keeps off the shore where it can. Returns the route
 * to the reachable cell closest to the target.
 */
function planWaterRoute(start: Cell, target: XZ, y: number): Route {
  const key = (c: Cell): string => `${c.x},${c.z}`;
  const parse = (k: string): Cell => {
    const [x, z] = k.split(",").map(Number);
    return { x: x!, z: z! };
  };
  const states = new Map<string, CellState>();
  const state = (x: number, z: number): CellState => {
    const k = `${x},${z}`;
    let s = states.get(k);
    if (s === undefined) {
      s = cellState(x, z, y);
      states.set(k, s);
    }
    return s;
  };
  const h = (c: Cell): number => distXZ({ x: c.x + 0.5, z: c.z + 0.5 }, target);

  const startKey = key(start);
  const g = new Map<string, number>([[startKey, 0]]);
  const from = new Map<string, string>();
  const open = new Heap();
  open.push({ f: h(start), key: startKey });
  let bestKey = startKey;
  let bestH = h(start);
  let expanded = 0;
  let sawUnknown = false;

  while (open.size > 0 && expanded < PLAN_BUDGET) {
    const { key: k } = open.pop()!;
    const c = parse(k);
    expanded++;
    const hc = h(c);
    if (hc < bestH) {
      bestH = hc;
      bestKey = k;
    }
    if (hc < 2) break;

    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const n = { x: c.x + dx, z: c.z + dz };
      const s = state(n.x, n.z);
      if (s === "unknown") sawUnknown = true;
      if (s !== "water") continue;
      // Diagonal only when both sides are open (the boat is wider than a block)
      if (dx !== 0 && dz !== 0 && (state(c.x + dx, c.z) !== "water" || state(c.x, c.z + dz) !== "water")) continue;
      let cost = dx !== 0 && dz !== 0 ? Math.SQRT2 : 1;
      for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (state(n.x + sx, n.z + sz) !== "water") cost += 2; // hugging the shore
      }
      const nk = key(n);
      const ng = g.get(k)! + cost;
      if (ng >= (g.get(nk) ?? Infinity)) continue;
      g.set(nk, ng);
      from.set(nk, k);
      open.push({ f: ng + h(n), key: nk });
    }
  }

  const cells: Cell[] = [];
  for (let k: string | undefined = bestKey; k; k = from.get(k)) cells.unshift(parse(k));
  return { cells, best: parse(bestKey), exhausted: open.size === 0 && !sawUnknown };
}

// --- Placing, boarding, rowing, landing ----------------------------------------

/** Open water within reach to launch from, preferring the target's side. */
function findLaunchWater(target: XZ, maxDistance = 24): Vec3 | null {
  const pos = bot.entity.position;
  const waterId = bot.registry.blocksByName["water"]?.id;
  if (waterId === undefined) return null;
  const candidates = bot
    .findBlocks({ matching: waterId, maxDistance, count: 200 })
    .filter((p) => cellState(p.x, p.z, p.y) === "water")
    // room around it, so the boat isn't wedged against the shore
    .filter((p) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => cellState(p.x + dx!, p.z + dz!, p.y) === "water").length >= 3);
  const score = (p: Vec3): number => p.distanceTo(pos) + 0.5 * distXZ(p, target);
  return candidates.sort((a, b) => score(a) - score(b))[0] ?? null;
}

/** Waits for a boat entity to appear near a spot. */
function waitForBoat(near: Vec3, timeoutMs: number): Promise<Entity | null> {
  return new Promise((resolve) => {
    const onSpawn = (entity: Entity): void => {
      if (!/boat|raft/.test(entity.name ?? "")) return;
      if (entity.position.distanceTo(near) > 4) return;
      cleanup();
      resolve(entity);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      bot.off("entitySpawn", onSpawn);
    };
    bot.on("entitySpawn", onSpawn);
  });
}

/** Waits for a mineflayer event, or gives up after a timeout. */
function waitFor(event: "mount" | "dismount", timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean): void => {
      clearTimeout(timer);
      bot.off(event, onEvent);
      resolve(ok);
    };
    const onEvent = (): void => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    bot.on(event, onEvent);
  });
}

/** Walks to the water, puts the boat on it and gets in. Returns the boat. */
async function launchBoat(target: XZ): Promise<{ boat: Entity; surfaceY: number } | null> {
  const water = findLaunchWater(target);
  const item = boatItem();
  if (!water || !item) return null;

  if (bot.entity.position.distanceTo(water.offset(0.5, 1, 0.5)) > 3.5) {
    try {
      await pathing.goto(new pf.goals.GoalNear(water.x, water.y + 1, water.z, 2));
    } catch (error) {
      console.log(`Boat: couldn't get to the water at ${water} (${(error as Error).message}).`);
      return null;
    }
  }
  if (isCommandCancelled()) return null;

  await bot.equip(item, "hand");
  await bot.lookAt(water.offset(0.5, 0.9, 0.5), true);
  const spawned = waitForBoat(water.offset(0.5, 1, 0.5), 3000);
  bot.activateItem(); // the server places the boat where the bot looks
  bot.deactivateItem();
  const boat = await spawned;
  if (!boat) {
    console.log(`Boat: placing it on the water at ${water} failed.`);
    return null;
  }

  await sleep(800); // let it settle on the water
  for (let attempt = 0; attempt < 3 && !bot.vehicle; attempt++) {
    if (bot.entity.position.distanceTo(boat.position) > 2.5) {
      try {
        await pathing.goto(new pf.goals.GoalNear(boat.position.x, boat.position.y, boat.position.z, 1));
      } catch {
        // close enough to try anyway
      }
    }
    bot.mount(boat);
    await waitFor("mount", 2000);
  }
  if (!bot.vehicle) {
    console.log("Boat: couldn't get into the boat.");
    await pickUpBoat(boat);
    return null;
  }
  return { boat, surfaceY: water.y };
}

/** The boat the bot is already sitting in (e.g. the owner put it there). */
function boardedBoat(): { boat: Entity; surfaceY: number } | null {
  const boat = bot.vehicle;
  if (!boat) return null;
  const surfaceY = surfaceAt(Math.floor(boat.position.x), Math.floor(boat.position.z), boat.position.y + 1);
  return surfaceY === null ? null : { boat, surfaceY };
}

/** An empty boat floating nearby (e.g. one the owner left), boarded if found. */
async function boardNearbyBoat(): Promise<{ boat: Entity; surfaceY: number } | null> {
  const boat = bot.nearestEntity(
    (e) => /boat|raft/.test(e.name ?? "") && e.passengers.length === 0 && e.position.distanceTo(bot.entity.position) < 10
  );
  if (!boat) return null;
  for (let attempt = 0; attempt < 3 && !bot.vehicle; attempt++) {
    if (bot.entity.position.distanceTo(boat.position) > 2.5) {
      try {
        await pathing.goto(new pf.goals.GoalNear(boat.position.x, boat.position.y, boat.position.z, 1));
      } catch {
        // close enough to try anyway
      }
    }
    bot.mount(boat);
    await waitFor("mount", 2000);
  }
  return bot.vehicle === boat ? boardedBoat() : null;
}

type RowResult = "done" | "stuck" | "cancelled" | "lost";

/** Rows the boat through the route's cells, one small move per tick. */
async function rowAlong(boat: Entity, cells: Cell[], boatY: number): Promise<RowResult> {
  let pos = boat.position.clone();
  const onServerMove = (packet: { x: number; y: number; z: number }): void => {
    pos = new Vec3(packet.x, packet.y, packet.z); // the server corrected us
  };
  bot._client.on("vehicle_move", onServerMove);
  const end = cells[cells.length - 1]!;
  let bestRemaining = Infinity;
  let lastProgressAt = Date.now();
  try {
    for (let i = 1; i < cells.length; ) {
      if (isCommandCancelled()) return "cancelled";
      if (!bot.vehicle) return "lost";

      // Aim a few cells ahead when it's a straight stretch, for a smoother line
      const wp = cells[Math.min(i + 2, cells.length - 1)]!;
      const tx = wp.x + 0.5;
      const tz = wp.z + 0.5;
      const dx = tx - pos.x;
      const dz = tz - pos.z;
      const d = Math.hypot(dx, dz);
      const near = cells[i]!;
      if (Math.hypot(near.x + 0.5 - pos.x, near.z + 0.5 - pos.z) < 1.2 || d < 0.3) {
        i++;
        continue;
      }

      const step = Math.min(SPEED, d);
      const nx = pos.x + (dx / d) * step;
      const nz = pos.z + (dz / d) * step;
      const yaw = (-Math.atan2(dx, dz) * 180) / Math.PI;
      bot._client.write("vehicle_move", { x: nx, y: boatY, z: nz, yaw, pitch: 0 });
      bot._client.write("steer_boat", { leftPaddle: true, rightPaddle: true });
      pos = new Vec3(nx, boatY, nz);
      boat.position.set(nx, boatY, nz);
      bot.entity.position.set(nx, boatY, nz);

      const remaining = distXZ(pos, { x: end.x + 0.5, z: end.z + 0.5 });
      if (remaining < bestRemaining - 1) {
        bestRemaining = remaining;
        lastProgressAt = Date.now();
      } else if (Date.now() - lastProgressAt > STUCK_MS) {
        return "stuck";
      }
      await sleep(TICK_MS);
    }
    return "done";
  } finally {
    bot._client.off("vehicle_move", onServerMove);
    bot._client.write("steer_boat", { leftPaddle: false, rightPaddle: false });
  }
}

/** Breaks the boat (it drops as an item) and picks it up. */
async function pickUpBoat(boat: Entity): Promise<void> {
  for (let hit = 0; hit < 12 && bot.entities[boat.id]; hit++) {
    if (bot.entity.position.distanceTo(boat.position) > 3) {
      try {
        await pathing.goto(new pf.goals.GoalNear(boat.position.x, boat.position.y, boat.position.z, 2));
      } catch {
        break; // drifted out of reach; leave it
      }
    }
    bot.attack(boat);
    await sleep(350);
  }
  const { pickupNearbyItems } = await import("./worldInteraction");
  await pickupNearbyItems(bot, 6);
}

/**
 * Crosses water toward the target by boat: walks to the water, places the
 * boat, rows along the water toward the target (re-planning as new chunks
 * load), lands at the shore closest to the target and takes the boat back.
 * Returns true if it got meaningfully closer to the target.
 */
export async function crossWaterByBoat(target: XZ): Promise<boolean> {
  const inBoat = /boat|raft/.test(bot.vehicle?.name ?? "");
  if (bot.vehicle && !inBoat) return false;
  const startDistance = distXZ(bot.entity.position, target);
  const launched = inBoat
    ? boardedBoat()
    : boatItem()
      ? await launchBoat(target)
      : await boardNearbyBoat();
  if (!launched) return false;
  const { boat, surfaceY } = launched;
  const boatY = boat.position.y;
  console.log(`Boat: on the water at ${boat.position.floored()}, heading for ${target.x}, ${target.z}.`);
  void tell("Taking my boat across the water.");

  try {
    for (let plan = 0; plan < MAX_PLANS; plan++) {
      const start = { x: Math.floor(boat.position.x), z: Math.floor(boat.position.z) };
      const route = planWaterRoute(start, target, surfaceY);
      if (route.cells.length <= 1) break; // nowhere closer by water
      const result = await rowAlong(boat, route.cells, boatY);
      if (result !== "done") {
        console.log(`Boat: rowing ended (${result}).`);
        break;
      }
      if (distXZ(route.best, target) <= 4 || route.exhausted) break;
    }
  } finally {
    // Getting out and taking the boat back also runs when the trip was
    // cancelled; the next command waits for it
    const landing = (async (): Promise<void> => {
      if (bot.vehicle) {
        bot.dismount();
        await waitFor("dismount", 3000);
        await sleep(600); // the server puts the bot on the shore
      }
      await pickUpBoat(boat);
    })();
    trackCleanup(landing);
    await landing;
  }

  const gained = startDistance - distXZ(bot.entity.position, target);
  console.log(`Boat: landed at ${bot.entity.position.floored()}, ${Math.round(gained)} blocks closer.`);
  return gained > 16;
}

/**
 * Rows to a spot by boat (for "take the boat to X Z"). Returns false if there
 * was no boat, no water nearby, or no way closer by water.
 */
export async function goByBoat(target: XZ): Promise<boolean> {
  const inBoat = /boat|raft/.test(bot.vehicle?.name ?? "");
  const boatNearby = bot.nearestEntity(
    (e) => /boat|raft/.test(e.name ?? "") && e.passengers.length === 0 && e.position.distanceTo(bot.entity.position) < 10
  );
  if (!inBoat && !boatNearby && !(await ensureBoat())) return false;
  return crossWaterByBoat(target);
}
