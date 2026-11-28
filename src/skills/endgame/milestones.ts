// Path: src/skills/endgame/milestones.ts
// The late game as milestones (Phase 9), after diamonds: tier 4 is the
// Nether (gear, the portal, a fortress, blaze rods, ender pearls), tier 5
// the End (eyes of ender, the stronghold, the End portal, the dragon). The
// curriculum and the day planner pick them like any other milestone; each
// is checked live and gets itself to the right dimension.

import type { Milestone } from "../milestones";
import { fail, ok, type ActionResult } from "../../core/result";
import { bot } from "../../core/body";
import { eyesNeeded } from "./geometry";
import { count, dimensionNow, endgame, goToDimension } from "./state";

/**
 * Eyes of ender it still needs in all: none once it's been to the End; once
 * the portal room is found, what the frame still needs plus one spare;
 * before that, 12 plus spares for throws that break. (A fixed 16 sent it
 * back to the Nether for rods whenever an eye broke.) Pure over its inputs.
 */
export function eyesWanted(e: { endVisited?: number; endPortal?: unknown; framesFilled?: number } = endgame()): number {
  if (e.endVisited) return 0;
  return e.endPortal ? eyesNeeded(e.framesFilled ?? 0, 1) : eyesNeeded();
}

/** Blaze rods still wanted, counting powder and eyes already made (a rod is two powder, an eye one powder). Pure over counts. */
export function rodsWanted(eyes: number, powder: number, wanted: number): number {
  return Math.max(0, Math.ceil((wanted - eyes - powder) / 2));
}

const acquireOne = async (item: string): Promise<ActionResult> => {
  const { acquire } = await import("../acquire");
  const { liveWorld } = await import("../world");
  return acquire(item, 1, liveWorld);
};

/** Carried anywhere, armour and off-hand included. */
const owns = (name: string): boolean => bot.inventory.slots.some((i) => i?.name === name);

export const ENDGAME_MILESTONES: Milestone[] = [
  // (The shield and the water bucket come right after the iron pickaxe now,
  // in skills/milestones.ts: a player makes them before going deep)
  {
    id: "flint_and_steel",
    title: "flint and steel",
    tier: 4,
    dimension: "any",
    requires: ["iron_tools"],
    done: () => owns("flint_and_steel") || Boolean(endgame().overworldPortal),
    achieve: () => acquireOne("flint_and_steel"),
  },
  {
    id: "nether_portal",
    title: "a Nether portal",
    tier: 4,
    dimension: "any",
    requires: ["diamond_pickaxe", "bucket", "flint_and_steel"],
    done: () => Boolean(endgame().overworldPortal),
    achieve: async () => (await import("./portal")).buildNetherPortal(),
  },
  {
    id: "nether",
    title: "a trip to the Nether",
    tier: 4,
    dimension: "any",
    // Blazes and piglins hit hard: the diamond sword and chestplate first
    requires: ["nether_portal", "shield", "diamond_sword", "diamond_chestplate"],
    done: () => Boolean(endgame().netherVisited),
    achieve: () => goToDimension("the_nether"),
  },
  {
    id: "fortress",
    title: "a Nether fortress",
    tier: 4,
    dimension: "any",
    requires: ["nether"],
    done: () => Boolean(endgame().fortress),
    achieve: async () => (await import("./nether")).findFortress(),
  },
  {
    id: "blaze_rods",
    title: "blaze rods",
    tier: 4,
    dimension: "any",
    requires: ["fortress"],
    done: () => count("blaze_rod") * 2 + count("blaze_powder") + count("ender_eye") >= eyesWanted(),
    achieve: async () => (await import("./nether")).getBlazeRods(rodsWanted(count("ender_eye"), count("blaze_powder"), eyesWanted())),
  },
  {
    id: "ender_pearls",
    title: "ender pearls",
    tier: 4,
    dimension: "any",
    requires: ["nether"],
    done: () => count("ender_pearl") + count("ender_eye") >= eyesWanted(),
    achieve: async () => (await import("./pearls")).getEnderPearls(eyesWanted()),
  },
  {
    id: "ender_eyes",
    title: "eyes of ender",
    tier: 5,
    dimension: "any",
    requires: ["blaze_rods", "ender_pearls"],
    done: () => count("ender_eye") >= eyesWanted(),
    achieve: async () => {
      const back = await goToDimension("overworld");
      if (!back.ok) return back;
      return (await import("./pearls")).craftEyes(eyesWanted());
    },
  },
  {
    id: "stronghold",
    title: "the stronghold",
    tier: 5,
    dimension: "any",
    requires: ["ender_eyes"],
    done: () => Boolean(endgame().endPortal),
    achieve: async () => {
      const s = await import("./stronghold");
      const located = await s.locateStronghold();
      return located.ok ? s.findPortalRoom() : located;
    },
  },
  {
    id: "end_portal",
    title: "the End portal",
    tier: 5,
    dimension: "any",
    requires: ["stronghold"],
    done: () => Boolean(endgame().endVisited),
    achieve: async () => {
      const s = await import("./stronghold");
      if (s.endPortalOpen()) return ok();
      return s.lightEndPortal();
    },
  },
  {
    id: "the_end",
    title: "a trip to the End",
    tier: 5,
    dimension: "any",
    // The dragon and the endermen: full diamond armour first
    requires: ["end_portal", "diamond_armor"],
    done: () => Boolean(endgame().endVisited),
    achieve: async () => (await import("./stronghold")).enterEnd(),
  },
  {
    id: "dragon",
    title: "the dragon",
    tier: 5,
    dimension: "any",
    requires: ["the_end"],
    done: () => Boolean(endgame().dragonDefeated),
    achieve: async () => {
      if (dimensionNow() !== "the_end") {
        // Back through the stronghold (it died in the End, or went home)
        const s = await import("./stronghold");
        const back = await goToDimension("overworld");
        if (!back.ok) return back;
        const { travelToResult } = await import("../../actions/movement");
        const c = endgame().endPortal;
        if (!c) return fail("not_found", "I don't know where the End portal is");
        await travelToResult(() => ({ x: c.x, y: c.y, z: c.z }), { range: 4 });
        const went = await s.enterEnd();
        if (!went.ok) return went;
      }
      return (await import("./dragon")).fightDragon();
    },
  },
  {
    id: "home_again",
    title: "home from the End",
    tier: 5,
    dimension: "any",
    requires: ["dragon"],
    // Out through the exit portal (the credits are skipped), home again
    done: () => Boolean(endgame().cameHome) || (Boolean(endgame().dragonDefeated) && dimensionNow() !== "the_end"),
    achieve: async () => (await import("./dragon")).leaveEnd(),
  },
];

/** Late-game milestones it may work on at night (in the Nether and the End there's no night; pearls are a night hunt). */
export const ENDGAME_NIGHT_OK = ["nether", "fortress", "blaze_rods", "ender_pearls", "the_end", "dragon", "home_again"];
