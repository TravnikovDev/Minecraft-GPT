// Path: src/core/sheltered.ts
// Whether the bot is shut in its shelter for the night. The reflexes read it:
// shut in, nothing outside can reach it, so it fights only what is in the
// room with it and never digs out to chase or flee (first game test: it broke
// its own seal to fight a phantom above ground).

let shelteredSince: number | null = null;

/** The night routine: shut in (true), or out again / cut off (false). */
export function setSheltered(on: boolean): void {
  shelteredSince = on ? Date.now() : null;
}

/** True while it's shut in its shelter. */
export function isSheltered(): boolean {
  return shelteredSince !== null;
}
