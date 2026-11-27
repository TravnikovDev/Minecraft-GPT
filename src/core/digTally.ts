// Path: src/core/digTally.ts
// What it has dug since it connected: every block, and coal ore. A coal trip
// reads them before and after (skills/coalDrought: a trip that dug its
// tunnels and saw no coal ore is a dry one).

let dug = 0;
let coalOre = 0;

/** Called for every block the bot breaks (core/setup's dig wrapper). */
export function noteDug(name: string): void {
  dug++;
  if (/^(deepslate_)?coal_ore$/.test(name)) coalOre++;
}

/** Blocks dug and coal ore dug so far. */
export function digTally(): { dug: number; coalOre: number } {
  return { dug, coalOre };
}
