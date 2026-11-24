// Path: src/actions/unstuck.ts
// The first step of getting unstuck (the stuck watcher in
// managers/stuckWatch.ts escalates: nudge, then replan, then give up): a
// small, player-like wiggle. It takes movement urgently for a moment, so the
// task's walking waits while it gets out of a boat, jumps and steps aside.

import { bot } from "../core/body";
import { asReflex, setReflexActive } from "../core/reflexes";
import { dismountVehicle, setControl } from "../core/primitives";
import { takeOverBody } from "../core/plugins";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Gets out of a boat if in one, jumps, and steps a little to one side and back. */
export async function nudge(): Promise<void> {
  setReflexActive("unstuck", true);
  try {
    await asReflex("unstuck", async () => {
      takeOverBody();
      if (bot.vehicle) await dismountVehicle();
      const side = Math.random() < 0.5 ? "left" : "right";
      setControl("jump", true);
      setControl(side, true);
      await sleep(600);
      setControl(side, false);
      setControl("back", true);
      await sleep(400);
      setControl("back", false);
      setControl("jump", false);
    });
    console.log("Unstuck: nudged (jumped and stepped aside).");
  } finally {
    setReflexActive("unstuck", false);
  }
}
