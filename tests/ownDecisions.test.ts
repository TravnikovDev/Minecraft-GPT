// Living its own life, nobody answers its questions (the owner's rule): on its
// own errands it decides itself and carries on; the owner's own commands
// still ask.
import { EventEmitter } from "node:events";
import { beforeEach, expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;

const said: string[] = [];
const fake: any = Object.assign(new EventEmitter(), {
  chat: (m: string) => said.push(m),
  whisper: (_to: string, m: string) => said.push(m),
  stopDigging: () => {},
  clearControlStates: () => {},
  pathfinder: { goal: null, setGoal: () => {}, isMoving: () => false },
});
useFakeBot(fake);
const A = await import(`${ROOT}/src/core/arbiter.ts`);
const D = await import(`${ROOT}/src/managers/ownerDialog.ts`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  useFakeBot(fake);
  A.resetArbiter();
  said.length = 0;
});

async function askDuring(bucket: number, onMyOwn: "yes" | "no"): Promise<string[]> {
  const answers: string[] = [];
  A.propose({
    name: "asking",
    bucket,
    run: async () => {
      D.askOwner("Hunt them anyway?", async () => void answers.push("yes"), async () => void answers.push("no"), 60_000, onMyOwn);
      await sleep(50);
    },
  });
  for (let i = 0; i < 50 && (A.currentTask() || A.pendingTasks().length); i++) await sleep(10);
  return answers;
}

test("its own errand: decided at once, nothing asked in chat", async () => {
  expect(await askDuring(A.Bucket.Self, "no")).toEqual(["no"]);
  expect(await askDuring(A.Bucket.Self, "yes")).toEqual(["yes"]);
  expect(D.hasPendingQuestion()).toBe(false);
  await sleep(50);
  expect(said.some((m) => m.includes("Hunt them anyway?"))).toBe(false);
});

test("the owner's command: the owner is asked", async () => {
  expect(await askDuring(A.Bucket.Owner, "no")).toEqual([]);
  expect(D.hasPendingQuestion()).toBe(true);
  await D.answerPending(false);
});
