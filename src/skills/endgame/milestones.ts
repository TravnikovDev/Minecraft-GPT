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

const EYES = eyesNeeded(); // 12 for the frame, a few spare for throws that break
const RODS = Math.ceil(EYES / 2); // a rod makes two powder, an eye takes one

const acquireOne = async (item: string): Promise<ActionResult> => {
  const { acquire } = await import("../acquire");
  const { liveWorld } = await import("../world");
  return acquire(item, 1, liveWorld);
};

/** Carried anywhere, armour and off-hand included. */
const owns = (name: string): boolean => bot.inventory.slots.some((i) => i?.name === name);

export const ENDGAME_MILESTONES: Milestone[] = [
  {
    id: "shield",
    title: "a shield",
    tier: 4,
    requires: ["iron_tools"],
    done: () => owns("shield"),
    achieve: async () => {
      const made = await acquireOne("shield");
      if (!made.ok) return made;
      const { equipItem } = await import("../../core/primitives");
      await equipItem("shield", "off-hand");
      return ok();
    },
  },
  {
    id: "bucket",
    title: "a bucket",
    tier: 4,
    requires: ["iron_tools"],
    done: () => owns("bucket") || owns("water_bucket") || owns("lava_bucket"),
    achieve: () => acquireOne("bucket"),
  },
  {
    id: "flint_and_steel",
    title: "flint and steel",
    tier: 4,
    requires: ["iron_tools"],
    done: () => owns("flint_and_steel") || Boolean(endgame().overworldPortal),
    achieve: () => acquireOne("flint_and_steel"),
  },
  {
    id: "nether_portal",
    title: "a Nether portal",
    tier: 4,
    requires: ["diamond_pickaxe", "bucket", "flint_and_steel"],
    done: () => Boolean(endgame().overworldPortal),
    achieve: async () => (await import("./portal")).buildNetherPortal(),
  },
  {
    id: "nether",
    title: "a trip to the Nether",
    tier: 4,
    requires: ["nether_portal", "shield"],
    done: () => Boolean(endgame().netherVisited),
    achieve: () => goToDimension("the_nether"),
  },
  {
    id: "fortress",
    title: "a Nether fortress",
    tier: 4,
    requires: ["nether"],
    done: () => Boolean(endgame().fortress),
    achieve: async () => (await import("./nether")).findFortress(),
  },
  {
    id: "blaze_rods",
    title: "blaze rods",
    tier: 4,
    requires: ["fortress"],
    done: () => count("blaze_rod") * 2 + count("blaze_powder") + count("ender_eye") >= EYES || Boolean(endgame().endVisited),
    achieve: async () => (await import("./nether")).getBlazeRods(RODS),
  },
  {
    id: "ender_pearls",
    title: "ender pearls",
    tier: 4,
    requires: ["nether"],
    done: () => count("ender_pearl") + count("ender_eye") >= EYES || Boolean(endgame().endVisited),
    achieve: async () => (await import("./pearls")).getEnderPearls(EYES),
  },
  {
    id: "ender_eyes",
    title: "eyes of ender",
    tier: 5,
    requires: ["blaze_rods", "ender_pearls"],
    done: () => count("ender_eye") >= EYES || Boolean(endgame().endVisited),
    achieve: async () => {
      const back = await goToDimension("overworld");
      if (!back.ok) return back;
      return (await import("./pearls")).craftEyes(EYES);
    },
  },
  {
    id: "stronghold",
    title: "the stronghold",
    tier: 5,
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
    requires: ["end_portal"],
    done: () => Boolean(endgame().endVisited),
    achieve: async () => (await import("./stronghold")).enterEnd(),
  },
  {
    id: "dragon",
    title: "the dragon",
    tier: 5,
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
];

/** Late-game milestones it may work on at night (in the Nether and the End there's no night; pearls are a night hunt). */
export const ENDGAME_NIGHT_OK = ["nether", "fortress", "blaze_rods", "ender_pearls", "the_end", "dragon"];
