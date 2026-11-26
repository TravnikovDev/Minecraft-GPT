// Path: src/commands/Role.ts
// The owner gives the bot a job (Phase 8), changes it, or takes it away:
// "be my guard", "be my farmer at this field, put the wheat in the chest
// here", "mine iron for me", "sort my chests", "build a hut here", "you're
// off duty", "what's your job?". Where the owner stands is where the job is.

import { z } from "zod";
import { Vec3 } from "vec3";
import { bot } from "../core/body";
import { reply } from "../core/narrator";
import { OWNER_USERNAME } from "../config/env";
import { STORAGE_BLOCKS } from "../core/containers";

export const description = `Gives the bot a standing job as the owner's companion, changes it, ends it, or tells what it is.
Jobs: guard (follows the owner and fights off mobs), farmer (harvests and replants a field, stores the crops), miner (mines an ore in its mine and brings it back), hauler (sorts the chests around), builder (builds a hut, a pen or a wall where the owner stands).
Examples: "Be my guard" (job guard); "Be my farmer here, put the wheat in the chest next to me" (job farmer, target wheat, storageNearMe true); "Mine iron for me" (job miner, target iron); "Sort my chests" (job hauler); "Build a hut here" (job builder, target hut); "You're off duty" / "stop being my farmer" (job off); "What's your job?" (job null).`;

export const parameters = z.object({
  job: z.enum(["guard", "farmer", "miner", "hauler", "builder", "off"]).nullable().describe("The job; off to end it; null to say what it is now."),
  target: z.string().nullable().describe("farmer: the crop (wheat, carrot, potato, beetroot); miner: the ore (iron, coal, diamond, gold); builder: hut, pen or wall. Null otherwise."),
  radius: z.number().nullable().describe("How far from the spot it works, in blocks, if the owner said so."),
  stance: z.enum(["follow", "stay", "patrol"]).nullable().describe("guard: follow (default) or stay at the spot. Null otherwise."),
  storageNearMe: z.boolean().nullable().describe("True when the owner points at a chest near them for the results."),
});

/** The owner's position, if the bot can see them. */
function ownerSpot(): Vec3 | null {
  const owner = bot.players[OWNER_USERNAME]?.entity;
  return owner ? owner.position.floored() : null;
}

/** The chest nearest a spot (within a few blocks). */
function chestNear(spot: Vec3): { x: number; y: number; z: number } | null {
  const ids = [...STORAGE_BLOCKS].map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  const found = bot.findBlocks({ matching: ids, point: spot, maxDistance: 6, count: 1 })[0];
  return found ? { x: found.x, y: found.y, z: found.z } : null;
}

export async function execute(args: z.infer<typeof parameters>): Promise<void> {
  const { currentRole, setRole, clearRole, makeRole, describeRole } = await import("../roles/role");
  const { resetRoleRest } = await import("../roles/runner");
  if (!args.job) {
    reply(describeRole(currentRole()));
    return;
  }
  if (args.job === "off") {
    const had = currentRole();
    await clearRole();
    const { cancelRunning, currentTask, dropPending } = await import("../core/arbiter");
    dropPending((t) => t.name.startsWith("role: "));
    if (currentTask()?.name.startsWith("role: ")) await cancelRunning("off duty", false);
    reply(had ? `Okay, I'm off duty as your ${had.job}.` : "I didn't have a job.");
    return;
  }
  const { automationAllowed } = await import("../config/serverProfile");
  if (!automationAllowed()) {
    reply("This server doesn't allow bots to work on their own, so I can't take a job here.");
    return;
  }
  const job = args.job;
  const here = ownerSpot();
  // Where the job is: where the owner stands (a guard follows them instead)
  const needsPlace = job === "farmer" || job === "builder" || job === "hauler";
  if (needsPlace && !here) {
    reply(`I can't see you. Stand where you want me to be your ${job} and tell me again.`);
    return;
  }
  const dimension = (bot.game as { dimension?: string }).dimension ?? "overworld";
  const anchor = here && (needsPlace || args.stance === "stay") ? { x: here.x, y: here.y, z: here.z, dimension } : null;
  const storage = args.storageNearMe && here ? chestNear(here) : null;
  if (args.storageNearMe && !storage) {
    reply("I don't see a chest near you; I'll use the nearest chest I know.");
  }
  const role = makeRole(job, { anchor, radius: args.radius, stance: args.stance, target: args.target, storage, at: Date.now() });
  await setRole(role);
  resetRoleRest();
  reply(describeRole(role));
}
