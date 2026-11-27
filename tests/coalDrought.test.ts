// Charcoal when its mine has had no coal for a while (owner, 2026-11-28),
// only with plenty of wood; a dry trip is one that really dug and found no
// coal ore (architect review).
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({ registry: require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4") });
const { tripWasDry, charcoalInstead, DRY_TRIPS, DRY_TRIP_DUG, TREE_LOGS_PLENTY } = await import(`${ROOT}/src/skills/coalDrought.ts`);

test("a dry trip dug its tunnels and broke no coal ore; a short or stopped trip never counts", () => {
  expect(tripWasDry(DRY_TRIP_DUG, 0)).toBe(true);
  expect(tripWasDry(300, 0)).toBe(true);
  expect(tripWasDry(DRY_TRIP_DUG - 1, 0)).toBe(false); // stopped early: not a real try
  expect(tripWasDry(300, 1)).toBe(false); // coal ore found
});

test("charcoal instead of the mine: two dry trips and plenty of wood (bag and chests, or trees by home)", () => {
  expect(DRY_TRIPS).toBe(2);
  expect(charcoalInstead(2, true, 0)).toBe(true);
  expect(charcoalInstead(2, false, TREE_LOGS_PLENTY)).toBe(true);
  expect(charcoalInstead(2, false, TREE_LOGS_PLENTY - 1)).toBe(false); // too little wood: on mining
  expect(charcoalInstead(1, true, 100)).toBe(false); // one dry trip isn't a drought
});

test("looking for coal finds charcoal too (it stands in for coal)", async () => {
  const { itemMatcher } = await import(`${ROOT}/src/actions/inventory.ts`);
  const m = itemMatcher("coal");
  expect(m("coal")).toBe(true);
  expect(m("charcoal")).toBe(true);
  expect(m("coal_block")).toBe(false);
});
