// A stand-in for src/core/body.ts in tests: the modules under test import
// `bot` from the Body, and each test file puts its own fake bot here.
import { mock } from "bun:test";

const ROOT = `${import.meta.dir}/..`;
const g = globalThis as { __testBot?: any; __testEndHooks?: Array<() => void> };

/** Installs `fake` as the bot the source modules see. Call before importing them. */
export function useFakeBot(fake: any): void {
  g.__testBot = fake;
  g.__testEndHooks = [];
}

/** Runs the cleanup registered with onConnectionEnd (as if the connection ended). */
export function endConnection(): void {
  for (const fn of (g.__testEndHooks ?? []).splice(0)) fn();
}

// Bun copies a mocked module's exports once, so `bot` is a stable proxy that
// forwards to whichever fake the current test installed
const botProxy = new Proxy(
  {},
  {
    get: (_t, key) => {
      const value = g.__testBot?.[key];
      return typeof value === "function" ? value.bind(g.__testBot) : value;
    },
    set: (_t, key, value) => {
      g.__testBot[key] = value;
      return true;
    },
    has: (_t, key) => key in (g.__testBot ?? {}),
  }
);

mock.module(`${ROOT}/src/core/body.ts`, () => ({
  bot: botProxy,
  onConnectionEnd: (_bot: unknown, fn: () => void) => g.__testEndHooks?.push(fn),
}));

/**
 * Moves the fake bot to a spot that satisfies a pathfinder goal near its
 * target, as a finished walk would (the checked goTo verifies arrival).
 */
export function arriveAt(fake: any, goal: any): void {
  const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
  const cx = Math.floor(goal.x ?? fake.entity.position.x);
  const cy = Math.floor(goal.y ?? fake.entity.position.y);
  const cz = Math.floor(goal.z ?? fake.entity.position.z);
  for (let r = 0; r <= 4; r++)
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
          const p = new Vec3(cx + dx, cy + dy, cz + dz);
          if (goal.isEnd(p)) {
            fake.entity.position = new Vec3(p.x + 0.5, p.y, p.z + 0.5);
            return;
          }
        }
}
