// Owner commands on the arbiter: a newer trip replaces an older one, "come
// here" cuts in on gathering and gathering carries on with what's left, the
// owner's stop wins over a cut-in that's still cleaning up, and following
// steps aside for the next command and comes back after it.
import { EventEmitter } from "node:events";
import { beforeEach, expect, mock, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;

const said: string[] = [];
const fake: any = Object.assign(new EventEmitter(), {
  chat: (m: string) => said.push(m),
  stopDigging: () => {},
  clearControlStates: () => {},
  pathfinder: { goal: null, setGoal: () => {}, isMoving: () => false },
});
useFakeBot(fake);

// Commands as the fake runs them: steps that check for a stop, counted ones report progress
const ran: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ctx = await import(`${ROOT}/src/core/commandContext.ts`);
mock.module(`${ROOT}/src/managers/toolManager.ts`, () => ({
  executeTool: async (name: string, args: any) => {
    const label = `${name}${args && Object.keys(args).length ? " " + JSON.stringify(args) : ""}`;
    ran.push(`start ${label}`);
    const steps = name === "followPlayer" ? 10_000 : (args?.num ?? args?.steps ?? 3);
    for (let i = 1; i <= steps; i++) {
      if (ctx.isCommandCancelled()) {
        ran.push(`stopped ${label} after ${i - 1}`);
        return;
      }
      await sleep(15);
      ctx.reportProgress(i);
    }
    ran.push(`done ${label}`);
  },
}));
const M = await import(`${ROOT}/src/managers/actionManager.ts`);
const A = await import(`${ROOT}/src/core/arbiter.ts`);
const cmd = (command: string, priority: number, args: any = {}) => ({ id: crypto.randomUUID(), command, priority, retryCount: 0, args });
const settle = async () => {
  for (let i = 0; i < 400 && (A.currentTask() || A.pendingTasks().length > 0); i++) await sleep(10);
};

beforeEach(() => {
  useFakeBot(fake);
  M.handleBotRejoin();
  ran.length = 0;
  said.length = 0;
});

test("a newer trip replaces an older one; the old one doesn't come back", async () => {
  M.queueCommand(cmd("goToCoordinates", 1, { x: 1, y: 64, z: 1, steps: 6 }));
  await sleep(40);
  M.queueCommand(cmd("goToCoordinates", 1, { x: 9, y: 64, z: 9, steps: 3 }));
  await settle();
  const starts = ran.filter((r) => r.startsWith("start"));
  expect(starts).toHaveLength(2); // no going back and forth
  expect(ran.at(-1)).toMatch(/^done goToCoordinates .*"x":9/);
  expect(said.filter((s) => s.startsWith("Back to"))).toEqual([]);
});

test("'come here' cuts in on gathering; then it gathers only what's left", async () => {
  M.queueCommand(cmd("gatherWood", 3, { num: 10 }));
  await sleep(70);
  M.queueCommand(cmd("goToPlayer", 1, { player_name: "Owner", steps: 2 }));
  await settle();
  const stopped = ran.find((r) => r.startsWith("stopped gatherWood"))!;
  const doneBefore = Number(/after (\d+)/.exec(stopped)![1]);
  const resumed = ran.filter((r) => r.startsWith("start gatherWood")).at(-1)!;
  const left = Number(/"num":(\d+)/.exec(resumed)![1]);
  expect(doneBefore).toBeGreaterThan(0);
  expect(doneBefore + left).toBe(10);
  expect(ran.indexOf(ran.find((r) => r.startsWith("done goToPlayer"))!)).toBeLessThan(ran.indexOf(resumed));
  expect(said).toContain("Back to gather wood.");
});

test("'stop' while a cut-in is still cleaning up: nothing comes back", async () => {
  M.queueCommand(cmd("collectBlocks", 3, { num: 20 }));
  await sleep(40);
  M.queueCommand(cmd("goToPlayer", 1, { player_name: "Owner" }));
  await M.stopEverything();
  await sleep(200);
  expect(A.currentTask()).toBeNull();
  expect(A.pendingTasks()).toEqual([]);
  expect(said.filter((s) => s.startsWith("Back to"))).toEqual([]);
});

test("following steps aside for the next command and carries on after it", async () => {
  M.queueCommand(cmd("followPlayer", 1, { player_name: "Owner", distance: 3 }));
  await sleep(40);
  M.queueCommand(cmd("craftItem", 3, { itemName: "stick", steps: 2 }));
  await sleep(300);
  expect(ran.some((r) => r.startsWith("done craftItem"))).toBe(true);
  expect(A.currentTask()?.name).toBe("followPlayer"); // following again
  expect(said).toContain("Back to follow player.");
  await M.stopEverything();
});

test("the same command still waiting isn't queued twice", async () => {
  M.queueCommand(cmd("craftItem", 3, { itemName: "chest", steps: 4 }));
  M.queueCommand(cmd("storeItems", 3, { what: "all" }));
  M.queueCommand(cmd("storeItems", 3, { what: "all" }));
  await settle();
  expect(ran.filter((r) => r.startsWith("start storeItems"))).toHaveLength(1);
  expect(said).toContain("That's already on my list.");
});
