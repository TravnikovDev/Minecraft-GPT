// "stop" must reach a walk that a reflex paused, the fight plugin must stop at
// once (never the pathfinder's deferred stop), and stop mutes fight/creeper reflexes.
import { beforeEach, expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;

const calls: string[] = [];
const fake = {
  vehicle: null,
  pathfinder: {
    goto: async () => { calls.push("goto"); throw new Error("interrupted"); },
    setGoal: (g: unknown) => calls.push(g === null ? "setGoal(null)" : "setGoal"),
    stop: () => calls.push("pathfinder.stop"),
    isMoving: () => false,
  },
  pvp: { forceStop: () => calls.push("pvp.forceStop"), stop: () => calls.push("pvp.stop"), target: undefined },
};
useFakeBot(fake);
beforeEach(() => useFakeBot(fake));
const { pathing, fighting } = await import(`${ROOT}/src/core/plugins.ts`);
const reflexes = await import(`${ROOT}/src/core/reflexes.ts`);
const { runWithSignal } = await import(`${ROOT}/src/core/commandContext.ts`);

test("a walk waiting out a reflex gives up as soon as the command is stopped", async () => {
  calls.length = 0;
  reflexes.setReflexActive("combat", true);
  const abort = new AbortController();
  const started = Date.now();
  const walk = runWithSignal(abort.signal, () => pathing.goto({} as any));
  setTimeout(() => abort.abort("Stopped by player"), 100);
  await expect(walk).rejects.toThrow("Cancelled");
  expect(Date.now() - started).toBeLessThan(800);
  expect(calls).not.toContain("goto"); // never walked on
  reflexes.setReflexActive("combat", false);
});

test("stopping uses immediate stops, never the deferred pathfinder/pvp stop", () => {
  calls.length = 0;
  pathing.stop();
  fighting.stop();
  expect(calls).toEqual(["setGoal(null)", "pvp.forceStop"]);
});

test("the owner's stop ends stoppable reflexes and mutes them; drowning isn't one", () => {
  reflexes.resetReflexes();
  const ended: string[] = [];
  reflexes.registerReflexStopper("combat", () => ended.push("combat"));
  reflexes.registerReflexStopper("creeper", () => ended.push("creeper"));
  expect(reflexes.areReflexesMuted()).toBe(false);
  reflexes.stopReflexes(60_000);
  expect(ended).toEqual(["combat", "creeper"]);
  expect(reflexes.areReflexesMuted()).toBe(true);
  reflexes.resetReflexes();
  expect(reflexes.areReflexesMuted()).toBe(false);
});
