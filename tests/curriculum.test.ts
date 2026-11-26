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
const realShelter = await import(`${ROOT}/src/actions/building.ts`);
mock.module(`${ROOT}/src/actions/building.ts`, () => ({
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
  // Stop first: a "what's next" timer left by the previous test must find it quiet
  await stopChores("Stopped by player", 60_000);
  await P.updateMemory({ autonomy: { on: true, since: Date.now() } });
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

test("the next milestone: the first not done and not set aside, then the next tier; null when all are done", () => {
  const list = [fakeMilestone("a"), fakeMilestone("b"), { ...fakeMilestone("later"), tier: 2 }];
  expect(M.nextMilestone(list)?.id).toBe("a");
  done.add("a");
  expect(M.nextMilestone(list)?.id).toBe("b");
  expect(M.nextMilestone(list, (id: string) => id === "b")).toBeNull();
  done.add("b");
  expect(M.tier1Reached(list)).toBe(true);
  expect(M.nextMilestone(list)?.id).toBe("later"); // then the next tier
  done.add("later");
  expect(M.nextMilestone(list)).toBeNull();
});

test("the owner's shelter, in any direction: stairs, entrance doorway, a 3x5 room, exit doorway", () => {
  const { shelterPlan } = realShelter;
  // South, as the original: stairs 4 down, the doorway, the room from 2 past the last stair
  const s = shelterPlan({ x: 0, y: 70, z: 0 }, "south");
  const at = (p: any) => [p.x, p.y, p.z];
  expect(at(s.enter)).toEqual([0, 66, 4]);
  expect(at(s.entrance)).toEqual([0, 66, 5]);
  expect(at(s.roomStart)).toEqual([0, 66, 6]);
  expect(at(s.exit)).toEqual([0, 66, 11]); // past the room's 5 rows: the mine starts here
  // setupTheShelter's spots, as they always were (x across, z along)
  expect(s.chests.map(at)).toEqual([[1, 66, 6], [1, 66, 7], [-1, 66, 6], [-1, 66, 7], [1, 66, 9], [1, 66, 10]]);
  expect(at(s.furnace)).toEqual([1, 66, 8]);
  expect(at(s.table)).toEqual([-1, 66, 8]);
  expect(at(s.bed)).toEqual([-1, 66, 9]); // head at z 10, along the wall
  // The middle column is clear from the entrance to the exit
  const key = (p: any) => at(p).join(",");
  const furnished = new Set([...s.chests.map(key), key(s.furnace), key(s.table), key(s.bed), "-1,66,10"]);
  for (let z = 6; z <= 10; z++) expect(furnished.has(`0,66,${z}`)).toBe(false);
  const dug = new Set(s.cells.map(key));
  for (const f of furnished) expect(dug.has(f)).toBe(true);
  // Turned to face north, the same shape
  const n = shelterPlan({ x: 0, y: 70, z: 0 }, "north");
  expect(at(n.roomStart)).toEqual([0, 66, -6]);
  expect(at(n.exit)).toEqual([0, 66, -11]);
  expect(at(n.furnace)).toEqual([1, 66, -8]);
});

test("after the first day it goes on to the mine: a mine, then coal, then iron", () => {
  const list = [fakeMilestone("a"), { ...fakeMilestone("mine"), tier: 2 }, { ...fakeMilestone("coal"), tier: 2 }];
  expect(M.nextMilestone(list)?.id).toBe("a");
  done.add("a");
  expect(M.nextMilestone(list)?.id).toBe("mine");
  expect(M.nextMilestone(list, (id: string) => id === "mine")?.id).toBe("coal");
  done.add("mine");
  done.add("coal");
  expect(M.nextMilestone(list)).toBeNull();
});

test("a blocked first-day milestone holds the mine back until the day is done", () => {
  const list = [fakeMilestone("bed"), { ...fakeMilestone("mine"), tier: 2 }];
  expect(M.nextMilestone(list, (id: string) => id === "bed")).toBeNull();
});

test("every item the milestones plan for is a real 1.20.4 item", () => {
  const names = ["wooden_pickaxe", "wooden_axe", "wooden_shovel", "wooden_sword", "stone_pickaxe", "stone_axe", "stone_shovel", "stone_sword", "furnace", "white_wool", "white_bed", "chest", "crafting_table", "raw_iron", "iron_ingot", "iron_pickaxe", "iron_sword", "iron_axe", "iron_shovel", "iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots", "diamond", "diamond_pickaxe", "cobblestone_stairs"];
  for (const n of names) expect(registry.itemsByName[n]).toBeDefined();
  expect(REAL.map((m) => m.id)).toEqual([
    "wooden_tools", "shelter", "stone_tools", "chests", "bed", "food", "mine", "coal", "torches", "lit_home", "paved_stairs", "iron", "iron_pickaxe",
    // First iron goes to safety: a shield, a water bucket, armour, then the other tools
    "shield", "bucket", "farm", "iron_armor", "lit_home_2", "iron_tools", "lit_home_3", "diamonds", "diamond_pickaxe",
    // Phase 9: the Nether and the End
    "flint_and_steel", "nether_portal", "nether", "fortress", "blaze_rods", "ender_pearls", "ender_eyes", "stronghold", "end_portal", "the_end", "dragon", "home_again",
  ]);
  for (const n of ["torch", "water_bucket", "shield", "bucket", "flint_and_steel", "obsidian", "blaze_rod", "blaze_powder", "ender_pearl", "ender_eye", "golden_helmet"]) expect(registry.itemsByName[n]).toBeDefined();
  expect(REAL.find((m) => m.id === "chests")?.title).toContain("chests, furnace, table");
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

test("the owner's order holds even when a milestone is set aside: no stone tools before the shelter", () => {
  const list = [fakeMilestone("shelter"), { ...fakeMilestone("stone_tools"), requires: ["shelter"] }, { ...fakeMilestone("mine"), tier: 2, requires: ["stone_tools"] }];
  // The shelter set aside: stone tools must not jump ahead
  expect(M.nextMilestone(list, (id: string) => id === "shelter")).toBeNull();
  done.add("shelter");
  expect(M.nextMilestone(list)?.id).toBe("stone_tools");
  done.add("stone_tools");
  expect(M.nextMilestone(list)?.id).toBe("mine");
  // The real list: furniture after stone tools, the mine after furniture
  const real = Object.fromEntries(REAL.map((m) => [m.id, m.requires ?? []]));
  expect(real["stone_tools"]).toContain("shelter");
  expect(real["chests"]).toEqual(["shelter", "stone_tools"]);
  expect(real["mine"]).toEqual(["stone_tools", "chests"]);
});

test("what a site leaves to build: none under solid ground, the open roof of a hillside, sand overhead", () => {
  const { shelterPlan, shellIsSolid, shellGaps } = realShelter;
  const plan = shelterPlan({ x: 0, y: 70, z: 0 }, "south");
  const roof = plan.roomStart.y + 3;
  const solid = () => ({ name: "dirt", boundingBox: "block" });
  expect(shellIsSolid(plan.shell, roof, solid)).toBe(true);
  // A hillside: the roof's far end is open air
  const hillside = (p: any) => (p.y >= roof && p.z >= 9 ? { name: "air", boundingBox: "empty" } : solid());
  expect(shellIsSolid(plan.shell, roof, hillside)).toBe(false);
  // Still a site: those roof blocks get built (3 wide x 2 rows open over z 9-10)
  expect(shellGaps(plan.shell, roof, hillside)).toBe(6);
  // A tree over it: leaves and logs in the roof are gaps too (they rot away or get chopped)
  const treeRoof = (p: any) => (p.y >= roof && p.z === 6 ? { name: p.x === 0 ? "oak_log" : "oak_leaves", boundingBox: "block" } : solid());
  expect(shellGaps(plan.shell, roof, treeRoof)).toBe(3);
  expect(shellGaps(plan.shell, roof, solid)).toBe(0);
  // A beach: sand over the room falls in
  const beach = (p: any) => (p.y >= roof ? { name: "sand", boundingBox: "block" } : solid());
  expect(shellIsSolid(plan.shell, roof, beach)).toBe(false);
  // The doorways are left open: not part of the shell
  const key = (p: any) => `${p.x},${p.y},${p.z}`;
  const shell = new Set(plan.shell.map(key));
  expect(shell.has(key(plan.entrance))).toBe(false);
  expect(shell.has(key(plan.exit))).toBe(false);
});

test("furniture goes in from the middle of its row, so the chests along a wall face the same way and pair up", () => {
  const { shelterPlan, rowStand, chestFacing } = realShelter;
  const s = shelterPlan({ x: 0, y: 70, z: 0 }, "south");
  const [c0, c1, c2, c3, c4, c5] = s.chests;
  // Standing in the same row, in the middle column
  expect(rowStand(c0, s.stand, "south")).toEqual(s.roomStart);
  expect(rowStand(c5, s.stand, "south")).toEqual(s.roomStart.offset(0, 0, 4));
  // East-side chests face west (toward the middle), west-side ones east: each pair faces one way
  expect([c0, c1, c4, c5].map((c) => chestFacing(c, s.stand, "south"))).toEqual(["west", "west", "west", "west"]);
  expect([c2, c3].map((c) => chestFacing(c, s.stand, "south"))).toEqual(["east", "east"]);
  // Going east the room runs along x and the chests sit north and south of the middle
  const e = shelterPlan({ x: 0, y: 70, z: 0 }, "east");
  expect(chestFacing(e.chests[0]!, e.stand, "east")).toBe("north");
  expect(chestFacing(e.chests[2]!, e.stand, "east")).toBe("south");
});

test("the shield, the water bucket and iron armour come before the other iron tools and diamonds", () => {
  const ids = REAL.map((m) => m.id);
  for (const early of ["shield", "bucket", "iron_armor"]) {
    expect(ids.indexOf(early)).toBeLessThan(ids.indexOf("iron_tools"));
    expect(ids.indexOf(early)).toBeLessThan(ids.indexOf("diamonds"));
    expect(REAL.find((m) => m.id === early)?.requires).toEqual(["iron_pickaxe"]);
  }
  expect(ids.indexOf("torches")).toBeLessThan(ids.indexOf("iron"));
  // The late game still waits for them
  expect(REAL.find((m) => m.id === "nether_portal")?.requires).toContain("bucket");
  expect(REAL.find((m) => m.id === "nether")?.requires).toContain("shield");
});

test("every milestone between the mine and diamonds is worked on at night (in the mine or at home)", async () => {
  const { worksAtNight } = await import(`${ROOT}/src/skills/curriculum.ts`);
  const ids = REAL.map((m) => m.id);
  const from = ids.indexOf("mine");
  const to = ids.indexOf("diamond_pickaxe");
  // (the lit home's grades are the daytime jobs: their torches go on the ground outside)
  const daytime = ["lit_home", "lit_home_2", "lit_home_3", "farm"];
  for (const id of ids.slice(from, to + 1).filter((i: string) => !daytime.includes(i))) expect([id, worksAtNight(id)]).toEqual([id, true]);
  for (const id of daytime) expect(worksAtNight(id)).toBe(false);
});

test("an optional milestone that can't be done now never holds its tier up", () => {
  // Review: a lighting grade with a spot it could never reach held the bot's whole day
  done.clear();
  const list = [{ ...fakeMilestone("lit"), tier: 2, optional: true }, { ...fakeMilestone("iron_x"), tier: 3 }];
  // Its turn: tried first
  expect(M.nextMilestone(list)?.id).toBe("lit");
  // Set aside (it failed): the next tier goes on
  expect(M.nextMilestone(list, (id: string) => id === "lit")?.id).toBe("iron_x");
  // A required one set aside still holds its tier
  const strict = [{ ...fakeMilestone("mine_x"), tier: 2 }, { ...fakeMilestone("iron_y"), tier: 3 }];
  expect(M.nextMilestone(strict, (id: string) => id === "mine_x")).toBeNull();
});

test("a supply it has had before, running low again, never holds its tier up", () => {
  // Review: eating below the food mark reopened the first day and froze every tier above it
  done.clear();
  const list = [{ ...fakeMilestone("food_x"), tier: 1, supply: true }, { ...fakeMilestone("mine_x"), tier: 2 }];
  // Never reached: it holds its tier like any other while set aside
  expect(M.nextMilestone(list, (id: string) => id === "food_x")).toBeNull();
});

test("once reached, a supply set aside lets the next tier go on", async () => {
  const { updateMemory, getMemory } = await import(`${ROOT}/src/managers/persistenceManager.ts`);
  await updateMemory({ milestones: { ...(getMemory().milestones ?? {}), food_y: Date.now() } });
  done.clear();
  const list = [{ ...fakeMilestone("food_y"), tier: 1, supply: true }, { ...fakeMilestone("mine_y"), tier: 2 }];
  expect(M.nextMilestone(list)?.id).toBe("food_y"); // its turn: restocked first
  expect(M.nextMilestone(list, (id: string) => id === "food_y")?.id).toBe("mine_y"); // failing: the day goes on
});

test("the safety order holds for the day plan: what holds a milestone back (review)", () => {
  done.clear();
  const all = () => true;
  const list = [
    { ...fakeMilestone("shield_z"), tier: 3 },
    { ...fakeMilestone("lit_z"), tier: 3, optional: true },
    { ...fakeMilestone("deep_z"), tier: 3, requires: ["shield_z"] },
    { ...fakeMilestone("nether_z"), tier: 4 },
  ];
  // Diamonds-like: its safety items first; the Nether-like: the whole tier before it
  expect(M.heldBy(list[2], list, all)).toEqual(["shield_z"]);
  expect(M.heldBy(list[3], list, all)).toEqual(["shield_z", "deep_z"]);
  done.add("shield_z");
  done.add("deep_z");
  // An optional one never holds anything back
  expect(M.heldBy(list[3], list, all)).toEqual([]);
  // The real diamonds wait for the shield, the bucket and the armour
  expect(REAL.find((m: { id: string }) => m.id === "diamonds")?.requires).toEqual(["iron_pickaxe", "shield", "bucket", "iron_armor"]);
});
