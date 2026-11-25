// Phase 6: living its own life. Off by default: nothing happens until the
// owner says "go live your life". Then it goes for the next milestone when
// nothing more urgent is running, one after another; the owner's commands cut
// in and it carries on afterwards; "stop" keeps it quiet; at night it goes to
// its shelter instead (once per night). Also the pure parts: which milestone
// is next, the shelter's shape, and that every item it plans for is real.
import { EventEmitter } from "node:events";
import { beforeEach, expect, mock, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");

const fake: any = Object.assign(new EventEmitter(), {
  registry,
  game: { dimension: "overworld" },
  entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, metadata: [] },
  entities: {},
  players: {},
  time: { timeOfDay: 1000, age: 1000 },
  isSleeping: false,
  inventory: { items: () => [], emptySlotCount: () => 30 },
  stopDigging: () => {},
  clearControlStates: () => {},
  pathfinder: { goal: null, setGoal: () => {}, isMoving: () => false },
  blockAt: () => null,
});
useFakeBot(fake);

// The shelter's digging and doors are game work (tested in game); here they just log
const shelterLog: string[] = [];
const realShelter = await import(`${ROOT}/src/skills/shelter.ts`);
mock.module(`${ROOT}/src/skills/shelter.ts`, () => ({
  ...realShelter,
  buildShelter: async () => (shelterLog.push("build"), { ok: true, value: undefined }),
  enterShelter: async () => (shelterLog.push("enter"), { ok: true, value: undefined }),
  leaveShelter: async () => (shelterLog.push("leave"), { ok: true, value: undefined }),
}));

const P = await import(`${ROOT}/src/managers/persistenceManager.ts`);
await P.loadDb();
const A = await import(`${ROOT}/src/core/arbiter.ts`);
const M = await import(`${ROOT}/src/skills/milestones.ts`);
const C = await import(`${ROOT}/src/skills/curriculum.ts`);
const { stopChores, resetChores } = await import(`${ROOT}/src/core/chores.ts`);
const { isCommandCancelled } = await import(`${ROOT}/src/core/commandContext.ts`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const idle = async () => {
  for (let i = 0; i < 300 && (A.currentTask() || A.pendingTasks().length > 0); i++) await sleep(10);
};

// Fake milestones: each takes a little while and is done afterwards
const REAL = [...M.MILESTONES];
let done = new Set<string>();
let runs: string[] = [];
function fakeMilestone(id: string, ms = 30) {
  return {
    id,
    title: id,
    tier: 1,
    done: () => done.has(id),
    achieve: async () => {
      runs.push(id);
      for (let t = 0; t < ms; t += 10) {
        if (isCommandCancelled()) return { ok: false, reason: "aborted", detail: "stopped" };
        await sleep(10);
      }
      done.add(id);
      return { ok: true, value: undefined };
    },
  };
}

beforeEach(async () => {
  useFakeBot(fake);
  A.resetArbiter();
  resetChores();
  C.resetCurriculum();
  M.MILESTONES.splice(0, M.MILESTONES.length, fakeMilestone("tools"), fakeMilestone("shelter"), fakeMilestone("food"));
  done = new Set();
  runs = [];
  shelterLog.length = 0;
  fake.time = { timeOfDay: 1000, age: 1000 };
  delete process.env["AUTONOMY"];
  await P.updateMemory({ autonomy: undefined, milestones: undefined, places: [], bed: undefined });
});

test("off by default: with no word from the owner it does nothing", async () => {
  await C.considerNextStep();
  await idle();
  expect(runs).toEqual([]);
  expect(C.autonomyOn()).toBe(false);
});

test("go live your life: it works through its milestones one after another and announces them", async () => {
  const said: string[] = [];
  fake.chat = (m: string) => said.push(m);
  await C.setAutonomy(true);
  for (let i = 0; i < 100 && done.size < 3; i++) await sleep(50); // each end proposes the next (1 s later)
  expect(runs).toEqual(["tools", "shelter", "food"]);
  await C.considerNextStep();
  expect(said.some((m) => m.includes("Milestone: tools"))).toBe(true);
  expect(said.some((m) => m.includes("first day"))).toBe(true);
  expect(P.getMemory().milestones?.["tier1"]).toBeGreaterThan(0);
  delete fake.chat;
}, 10_000);

test("the owner's command cuts in; the milestone carries on afterwards", async () => {
  M.MILESTONES.splice(0, M.MILESTONES.length, fakeMilestone("tools", 300));
  await P.updateMemory({ autonomy: { on: true, since: Date.now() } });
  await C.considerNextStep();
  await sleep(50);
  expect(A.currentTask()?.name).toBe("milestone: tools");
  const order: string[] = [];
  A.propose({ name: "owner: come here", bucket: A.Bucket.Owner, run: async () => void order.push("owner") });
  await idle();
  expect(order).toEqual(["owner"]);
  expect(runs).toEqual(["tools", "tools"]); // started again after the owner's command
  expect(done.has("tools")).toBe(true);
});

test("an owner's task waiting: it doesn't start a milestone in front of it", async () => {
  await P.updateMemory({ autonomy: { on: true, since: Date.now() } });
  A.propose({ name: "owner: long job", bucket: A.Bucket.Owner, run: () => sleep(100) });
  await C.considerNextStep();
  expect(A.pendingTasks().some((t) => t.name.startsWith("milestone"))).toBe(false);
  await idle();
});

test("stop keeps it quiet: no milestone while the owner's stop holds", async () => {
  await P.updateMemory({ autonomy: { on: true, since: Date.now() } });
  await stopChores("Stopped by player", 60_000);
  await C.considerNextStep();
  await idle();
  expect(runs).toEqual([]);
});

test("night: it goes to its shelter (digging one first), once per night, and comes out at dawn", async () => {
  await P.updateMemory({ autonomy: { on: true, since: Date.now() } });
  fake.time = { timeOfDay: 14000, age: 24000 * 3 + 14000 };
  await C.considerNextStep();
  await sleep(50);
  expect(A.currentTask()?.name).toBe("night: going to my shelter");
  expect(shelterLog).toEqual(["build", "enter"]);
  await C.considerNextStep(); // the same night: not again
  expect(A.pendingTasks().length).toBe(0);
  expect(runs).toEqual([]); // no milestones in the dark
  fake.time = { timeOfDay: 0, age: 24000 * 4 };
  await idle();
  expect(shelterLog).toEqual(["build", "enter", "leave"]);
}, 10_000);

test("a milestone that fails is set aside for a while; the next one is tried", async () => {
  await P.updateMemory({ autonomy: { on: true, since: Date.now() } });
  const broken = { ...fakeMilestone("bed"), achieve: async () => (runs.push("bed"), { ok: false, reason: "missing_items", detail: "no sheep" }) };
  M.MILESTONES.splice(0, M.MILESTONES.length, broken, fakeMilestone("chests"));
  await C.considerNextStep();
  for (let i = 0; i < 60 && !done.has("chests"); i++) await sleep(50);
  expect(runs).toEqual(["bed", "chests"]);
}, 10_000);

// --- The pure parts ------------------------------------------------------------

test("the next milestone: the first not done and not set aside; null when the first day is complete", () => {
  const list = [fakeMilestone("a"), fakeMilestone("b"), { ...fakeMilestone("later"), tier: 2 }];
  expect(M.nextMilestone(list)?.id).toBe("a");
  done.add("a");
  expect(M.nextMilestone(list)?.id).toBe("b");
  expect(M.nextMilestone(list, (id: string) => id === "b")).toBeNull();
  done.add("b");
  expect(M.nextMilestone(list)).toBeNull();
  expect(M.tier1Reached(list)).toBe(true);
});

test("the shelter's shape: stairs 5 down the way it faces, sealed at the bottom, fixed spots in the room", () => {
  const { shelterLayout } = realShelter;
  const s = shelterLayout({ x: 10, y: 70, z: -4 }, "north");
  const at = (p: any) => [p.x, p.y, p.z];
  expect(at(s.bottom)).toEqual([10, 65, -9]);
  expect(s.seal.map((p: any) => p.y)).toEqual([65, 66, 67]);
  expect(at(s.stand)).toEqual([10, 65, -10]); // first row, by the stairs
  expect(at(s.bed)).toEqual([10, 65, -11]); // foot in the middle row, head in the last
  expect(s.chests.map(at)).toEqual([[11, 65, -12], [9, 65, -12]]); // the last row's corners
  // Nothing is ever put where it stands, or on the way in
  const key = (p: any) => at(p).join(",");
  const furnished = new Set([key(s.bed), key(s.bed.offset(0, 0, -1)), ...s.chests.map(key)]);
  expect(furnished.has(key(s.stand))).toBe(false);
  expect(s.seal.some((p: any) => furnished.has(key(p)))).toBe(false);
  // Every furnished spot is a dug cell
  const dug = new Set(s.cells.map(key));
  for (const f of furnished) expect(dug.has(f)).toBe(true);
  const e = shelterLayout({ x: 0, y: 64, z: 0 }, "east");
  expect([e.stand.x, e.stand.z]).toEqual([6, 0]);
});

test("every item the milestones plan for is a real 1.20.4 item", () => {
  const names = ["wooden_pickaxe", "wooden_sword", "stone_pickaxe", "stone_sword", "stone_axe", "furnace", "white_wool", "white_bed", "chest", "crafting_table"];
  for (const n of names) expect(registry.itemsByName[n]).toBeDefined();
  expect(REAL.map((m) => m.id)).toEqual(["wooden_tools", "shelter", "stone_tools", "food", "bed", "chests"]);
});

test("stay with me: the milestone it's on ends now, and no new one starts", async () => {
  M.MILESTONES.splice(0, M.MILESTONES.length, fakeMilestone("tools", 2_000), fakeMilestone("food"));
  await C.setAutonomy(true);
  await sleep(100);
  expect(A.currentTask()?.name).toBe("milestone: tools");
  await C.setAutonomy(false);
  await sleep(1_500); // past the next look at what's next
  expect(A.currentTask()).toBeNull();
  expect(runs).toEqual(["tools"]);
  expect(done.size).toBe(0);
}, 10_000);

test("a milestone given up as stuck is set aside; it goes on to the next", async () => {
  M.MILESTONES.splice(0, M.MILESTONES.length, fakeMilestone("tools", 2_000), fakeMilestone("food"));
  await P.updateMemory({ autonomy: { on: true, since: Date.now() } });
  await C.considerNextStep();
  await sleep(100);
  await A.cancelRunning("stuck", false); // what the stuck watcher does
  for (let i = 0; i < 60 && !done.has("food"); i++) await sleep(50);
  expect(runs).toEqual(["tools", "food"]);
}, 10_000);
