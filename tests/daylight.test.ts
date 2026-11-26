// Path: tests/daylight.test.ts
// The one clock: working daylight and the time mobs are out.
import { describe, expect, test } from "bun:test";
import { isDaylight, isMobTime } from "../src/core/daylight";

describe("daylight", () => {
  test("day and dawn are daylight; sunset on is evening", () => {
    expect(isDaylight(0)).toBe(true);
    expect(isDaylight(11_999)).toBe(true);
    expect(isDaylight(12_000)).toBe(false);
    expect(isDaylight(18_000)).toBe(false);
    expect(isDaylight(22_999)).toBe(false);
    expect(isDaylight(23_000)).toBe(true);
  });
  test("mobs are out from 13000 to dawn", () => {
    expect(isMobTime(12_500)).toBe(false);
    expect(isMobTime(13_000)).toBe(true);
    expect(isMobTime(22_999)).toBe(true);
    expect(isMobTime(23_000)).toBe(false);
  });
});
