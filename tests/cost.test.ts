// Phase 7: every model call is priced and counted per month; a new month
// starts from zero.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { priceOf, withCall, monthOf } = await import(`${ROOT}/src/planner/cost.ts`);

test("a day plan of 7k in, 0.8k out costs about $0.0011", () => {
  expect(priceOf("gpt-6-luna", 7000, 800)).toBeCloseTo(0.0011, 5);
});

test("calls add up within a month, by purpose; a new month starts over", () => {
  const nov = Date.UTC(2026, 10, 26);
  let u = withCall(null, nov, "plan", "gpt-6-luna", 7000, 800);
  u = withCall(u, nov, "chat", "gpt-6-luna", 3000, 100);
  expect(u.month).toBe("2026-11");
  expect(u.calls).toBe(2);
  expect(u.usd).toBeCloseTo(0.0011 + 0.00035, 6);
  expect(Object.keys(u.byPurpose).sort()).toEqual(["chat", "plan"]);
  const dec = withCall(u, Date.UTC(2026, 11, 1), "chat", "gpt-6-luna", 1000, 0);
  expect(dec.month).toBe("2026-12");
  expect(dec.calls).toBe(1);
  expect(monthOf(nov)).toBe("2026-11");
});

test("an unknown model is priced high, so the cap errs on the safe side", () => {
  expect(priceOf("some-new-model", 1_000_000, 0)).toBeGreaterThan(priceOf("gpt-6-luna", 1_000_000, 0));
});
