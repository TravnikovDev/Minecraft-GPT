// Phase 4: one arbiter decides what runs. More urgent tasks cut in, the old
// task cleans up before the next starts, a cut-off task carries on afterwards
// with what's left, tasks of the same bucket wait their turn, and the owner's
// stop ends everything.
import { EventEmitter } from "node:events";
import { beforeEach, expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;

const fake: any = Object.assign(new EventEmitter(), {
  stopDigging: () => {},
  clearControlStates: () => {},
  pathfinder: { goal: null, setGoal: () => {}, isMoving: () => false },
});
useFakeBot(fake);
const A = await import(`${ROOT}/src/core/arbiter.ts`);
const { isCommandCancelled, getCurrentCommandName, reportProgress, currentSignal, progressOf } = await import(`${ROOT}/src/core/commandContext.ts`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let log: string[] = [];
beforeEach(() => {
  useFakeBot(fake);
  A.resetArbiter();
  log = [];
});

/** A task that works in steps until it's done or cancelled, logging as it goes. */
function worker(name: string, bucket: number, steps: number, extra: Partial<any> = {}) {
  return {
    name,
    bucket,
    run: async () => {
      log.push(`${name} start`);
      for (let i = 1; i <= steps; i++) {
        if (isCommandCancelled()) {
          log.push(`${name} cancelled at ${i - 1}`);
          return;
        }
        await sleep(20);
        reportProgress(i);
      }
      log.push(`${name} done`);
    },
    ...extra,
  };
}
const idle = async () => {
  for (let i = 0; i < 200 && (A.currentTask() || A.pendingTasks().length > 0); i++) await sleep(10);
};

test("an owner task cuts in on an idle chore; the chore isn't resumed", async () => {
  A.propose(worker("tidying up", 6, 20));
  await sleep(30);
  A.propose(worker("gatherWood", 2, 2));
  await idle();
  expect(log).toEqual(["tidying up start", expect.stringMatching(/^tidying up cancelled at \d$/), "gatherWood start", "gatherWood done"]);
});

test("same bucket: the running task keeps going and the next waits its turn", async () => {
  A.propose(worker("craftItem", 2, 3));
  A.propose(worker("storeItems", 2, 1));
  await idle();
  expect(log).toEqual(["craftItem start", "craftItem done", "storeItems start", "storeItems done"]);
});

test("'come here' cuts in on gathering, then gathering carries on with what's left", async () => {
  let resumedWith: number | null = null;
  const gather = (total: number): any => {
    let signal: AbortSignal | undefined;
    return {
      ...worker(`gather ${total}`, 2, total),
      run: async () => {
        signal = currentSignal();
        await worker(`gather ${total}`, 2, total).run();
      },
      resume: () => {
        const left = total - progressOf(signal!);
        resumedWith = left;
        return left > 0 ? gather(left) : null;
      },
    };
  };
  A.propose(gather(10));
  await sleep(75); // a few done
  A.propose({ ...worker("goToPlayer", 2, 1), interrupts: true });
  await idle();
  expect(resumedWith).toBeGreaterThan(0);
  expect(resumedWith).toBeLessThan(10);
  expect(log[0]).toBe("gather 10 start");
  expect(log[1]).toMatch(/^gather 10 cancelled at \d+$/);
  expect(log.slice(2)).toEqual(["goToPlayer start", "goToPlayer done", `gather ${resumedWith} start`, `gather ${resumedWith} done`]);
  const doneBefore = Number(/at (\d+)/.exec(log[1])![1]);
  expect(doneBefore + resumedWith!).toBe(10); // nothing gathered twice, nothing skipped
});

test("the next task starts only after the cancelled one has cleaned up", async () => {
  A.propose({
    name: "smelting",
    bucket: 4,
    run: async () => {
      while (!isCommandCancelled()) await sleep(10);
      await sleep(100); // closing the furnace
      log.push("smelting cleaned up");
    },
  });
  await sleep(20);
  A.propose(worker("goToCoordinates", 2, 1));
  await idle();
  expect(log).toEqual(["smelting cleaned up", "goToCoordinates start", "goToCoordinates done"]);
});

test("the owner's stop ends the running task and drops everything waiting", async () => {
  A.propose(worker("collectBlocks", 2, 50));
  A.propose(worker("craftItem", 2, 1));
  A.propose(worker("tidying up", 6, 1));
  await sleep(30);
  await A.stopAll("Stopped by player");
  await sleep(50);
  expect(A.currentTask()).toBeNull();
  expect(A.pendingTasks()).toEqual([]);
  expect(log).toEqual(["collectBlocks start", expect.stringMatching(/collectBlocks cancelled/)]);
});

test("owner tasks show as the current command; idle chores don't", async () => {
  A.propose(worker("tidying up", 6, 5));
  await sleep(15);
  expect(getCurrentCommandName()).toBeNull();
  A.propose(worker("hunting", 2, 5));
  await sleep(40);
  expect(getCurrentCommandName()).toBe("hunting");
  await idle();
});

test("a task that runs too long is stopped", async () => {
  A.propose({ ...worker("goByBoat", 2, 1000), maxMs: 60 });
  await idle();
  expect(log[0]).toBe("goByBoat start");
  expect(log[1]).toMatch(/cancelled/);
});

test("waiting work runs in priority order: upkeep before chores, earlier steps first", async () => {
  A.propose(worker("busy", 2, 3));
  A.propose(worker("tidying up", 6, 1));
  A.propose(worker("eat", 4, 1));
  A.propose(worker("recoverItems", 2, 1), { front: true });
  A.propose(worker("starterKit", 2, 1), { front: true });
  await idle();
  expect(log.filter((l) => l.endsWith("start"))).toEqual(["busy start", "recoverItems start", "starterKit start", "eat start", "tidying up start"]);
});
