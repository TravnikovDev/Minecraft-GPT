// Path: src/core/sheltered.ts
// Whether the bot is shut in its shelter for the night. The reflexes read it:
// shut in, nothing outside can reach it, so it fights only what is in the
// room with it and never digs out to chase or flee (first game test: it broke
// its own seal to fight a phantom above ground).
// The night routine says so, and where it stands decides it: a chore inside
// the routine that walks off (to the mine for coal) is out again (review: it
// mined with the reflexes thinking it was sealed in).

import { bot } from "./body";

let shelteredSince: number | null = null;
type Pos = { x: number; y: number; z: number };
// Whether a position is in its shelter's room (set by actions/building)
let inRoom: ((p: Pos) => boolean) | null = null;

/** The night routine: shut in (true), or out again / cut off (false). */
export function setSheltered(on: boolean): void {
  shelteredSince = on ? Date.now() : null;
}

/** Where its shelter's room is, for the check below (actions/building). */
export function setShelterRoomCheck(check: (p: Pos) => boolean): void {
  inRoom = check;
}

/** True while it's shut in its shelter: the night routine says so and it stands in the room. */
export function isSheltered(): boolean {
  if (shelteredSince === null) return false;
  const at = bot.entity?.position;
  return !inRoom || !at || inRoom(at);
}
