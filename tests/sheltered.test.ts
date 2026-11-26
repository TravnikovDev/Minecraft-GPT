// Path: tests/sheltered.test.ts
// Shut in for the night counts only while it stands in its room (review: a
// chore inside the night routine walked to the mine with the reflexes
// thinking it was sealed in).
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const fake: any = { entity: { position: { x: 0, y: 64, z: 0 } } };
useFakeBot(fake);
const S = await import(`${ROOT}/src/core/sheltered.ts`);

test("sheltered: the night routine says so and it stands in the room", () => {
  S.setShelterRoomCheck((p: { x: number; y: number }) => p.y === 64);
  S.setSheltered(false);
  expect(S.isSheltered()).toBe(false);
  S.setSheltered(true);
  expect(S.isSheltered()).toBe(true);
  // Walked off down its mine: out again, whatever the routine says
  fake.entity.position = { x: 0, y: 40, z: 0 };
  expect(S.isSheltered()).toBe(false);
  fake.entity.position = { x: 0, y: 64, z: 0 };
  expect(S.isSheltered()).toBe(true);
  S.setSheltered(false);
});
