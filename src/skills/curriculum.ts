// Path: src/skills/curriculum.ts
// Living its own life (Phase 6), when the owner turns it on ("go live your
// life"; off by default, so it never starts cutting trees near the owner's
// base on its own):
// - Day 1 curriculum: when nothing more urgent is running or waiting, it goes
//   for the next Tier 1 milestone (bucket 5, "self"). Owner commands cut in;
//   it carries on afterwards. A milestone that fails is set aside for a while.
// - Night (bucket 4, upkeep): at dusk it goes into its shelter (digging one
//   first if it has none), seals the stairs, sleeps if it has a bed, and opens
//   up again in the morning.
// The owner's "stop" pauses all of it (the same quiet minute as the chores).

import { bot, isOnline } from "../core/body";
import { Bucket, cancelRunning, type TaskSpec, currentTask, dropPending, onTaskEnd, onTaskStart, pendingTasks, propose } from "../core/arbiter";
import { areChoresMuted } from "../core/chores";
import { isCommandCancelled } from "../core/commandContext";
import { report } from "../core/narrator";
import { setSheltered } from "../core/sheltered";
import { describeFailure } from "../core/result";
import { getMemory, updateMemory } from "../managers/persistenceManager";
import { sky } from "../actions/perception";
import { MILESTONES, nextMilestone, noteReached, tier1Reached, type Milestone } from "./milestones";
import { hasBed, shelter } from "./capabilities";
import { buildShelter, enterShelter, leaveShelter } from "../actions/building";
import { clearDemotions } from "./acquire";

// A milestone that failed waits a little (10 minutes left it idle in a field)
const BLOCKED_FOR_MS = 2 * 60_000;
// The same reason for several milestones in a row (no wood blocks them all) is said once
let lastFailureSaid = { why: "", at: 0 };
const MILESTONE_MAX_MS = 15 * 60_000;
// A Minecraft night (dusk to dawn) is about 9 real minutes; a backstop past it
const NIGHT_MAX_MS = 12 * 60_000;
const MILESTONE_PREFIX = "milestone: ";
const NIGHT_NAME = "night: going to my shelter";
const isOwnLife = (task: { name: string; bucket: number }): boolean =>
  (task.bucket === Bucket.Self && task.name.startsWith(MILESTONE_PREFIX)) || task.name === NIGHT_NAME;
const blockedUntil = new Map<string, number>();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** True when the owner let it live its own life. */
export function autonomyOn(): boolean {
  return getMemory().autonomy?.on ?? process.env["AUTONOMY"] === "on";
}

/** The owner turns it on ("go live your life") or off ("stay with me"). */
export async function setAutonomy(on: boolean): Promise<void> {
  await updateMemory({ autonomy: { on, since: Date.now() } });
  if (on) {
    void considerNextStep();
    return;
  }
  // "Stay with me": its own milestones and night routine end now
  dropPending(isOwnLife);
  const running = currentTask();
  if (running && isOwnLife(running)) await cancelRunning("the owner wants me to wait for orders", false);
}

const isBlocked = (id: string): boolean => (blockedUntil.get(id) ?? 0) > Date.now();
/** True when a task at `bucket` or more urgent is running or waiting. */
const busyWith = (bucket: number): boolean => {
  const running = currentTask();
  return (running !== null && running.bucket <= bucket) || pendingTasks().some((t) => t.bucket <= bucket);
};
const isNight = (): boolean => {
  const s = sky();
  return s.known && (s.value.phase === "night" || s.value.phase === "dusk");
};

/** Announces milestones reached for the first time. */
async function announce(): Promise<void> {
  for (const m of await noteReached()) {
    const done = MILESTONES.filter((x) => x.tier === m.tier && x.done()).length;
    const total = MILESTONES.filter((x) => x.tier === m.tier).length;
    report(`Milestone: ${m.title} (${done} of ${total} ${m.tier === 1 ? "for my first day" : "for my mine"}).`);
  }
  if (tier1Reached() && !getMemory().milestones?.["tier1"]) {
    await updateMemory({ milestones: { ...(getMemory().milestones ?? {}), tier1: Date.now() } });
    report("I've got everything for my first day: tools, a shelter, food, a bed and my chests!");
  }
}

/** The task that goes for a milestone (resumed from where things stand if something cuts in). */
function milestoneTask(m: Milestone): TaskSpec {
  const spec: TaskSpec = {
    name: `${MILESTONE_PREFIX}${m.title}`,
    bucket: Bucket.Self,
    maxMs: MILESTONE_MAX_MS,
    run: async () => {
      const result = await m.achieve();
      await announce();
      if (!result.ok && !isCommandCancelled()) {
        blockedUntil.set(m.id, Date.now() + BLOCKED_FOR_MS);
        const why = describeFailure(result);
        if (why === lastFailureSaid.why && Date.now() - lastFailureSaid.at < BLOCKED_FOR_MS) {
          console.log(`Couldn't get ${m.title} either: ${why}.`);
        } else {
          report(`I couldn't get ${m.title} yet: ${why}. I'll try again in a couple of minutes.`);
          lastFailureSaid = { why, at: Date.now() };
        }
      }
    },
    // After a cut-in: carried on, unless done meanwhile, turned off, or night came
    resume: () => (m.done() || !autonomyOn() || isNight() ? null : milestoneTask(m)),
  };
  return spec;
}

let nightOf = -1; // the day number of the night already handled

/** The night routine: shelter, seal, sleep if there's a bed; open up in the morning. */
function nightTask(): TaskSpec {
  return {
    name: NIGHT_NAME,
    bucket: Bucket.Upkeep,
    // Waiting for the morning is standing still on purpose
    watchProgress: false,
    maxMs: NIGHT_MAX_MS,
    // The owner called it out at night: back in afterwards
    resume: () => (isNight() && autonomyOn() ? nightTask() : null),
    run: async () => {
      if (!shelter()) {
        const dug = await buildShelter();
        if (!dug.ok) {
          report(`I couldn't dig a shelter for the night: ${describeFailure(dug)}.`);
          return;
        }
      }
      const inside = await enterShelter();
      if (!inside.ok) {
        report(`I couldn't get into my shelter: ${describeFailure(inside)}.`);
        return;
      }
      // Shut in: the reflexes leave what's outside alone until morning
      setSheltered(true);
      try {
        if (hasBed()) {
          const { execute: sleepInBed } = await import("../commands/Sleep");
          await sleepInBed({ newBed: false });
        }
        // Wait for the morning (or for something more urgent to cut in)
        while (isNight() && !isCommandCancelled()) await sleep(2_000);
      } finally {
        setSheltered(false);
      }
      if (!isCommandCancelled()) await leaveShelter();
    },
  };
}

/**
 * Called when a task ends, on spawn and every few seconds: proposes the night
 * routine or the next milestone when it's free to live its own life.
 */
export async function considerNextStep(): Promise<void> {
  // Offline (the world closed): nothing to start until it's back
  if (!bot.entity || !isOnline() || !autonomyOn() || areChoresMuted()) return;
  await announce();
  // Night comes first: it cuts in on a milestone (upkeep outranks "self"),
  // but waits for the owner's commands
  // The world's day (it moves on when someone sleeps; the age doesn't)
  const day = bot.time?.day ?? 0;
  if (isNight() && !bot.isSleeping && nightOf !== day && !busyWith(Bucket.Upkeep)) {
    nightOf = day;
    propose(nightTask());
    return;
  }
  if (busyWith(Bucket.Self) || isNight()) return;
  const next = nextMilestone(MILESTONES, isBlocked);
  if (next) propose(milestoneTask(next));
}

/** The milestones, for "what's your progress?". */
export function progressReport(): string {
  const tier1 = MILESTONES.filter((m) => m.tier === 1);
  const done = tier1.filter((m) => m.done());
  const left = tier1.filter((m) => !m.done());
  const state = autonomyOn() ? "I'm living my own life" : "I'm waiting for you to tell me what to do (say \"go live your life\" to let me)";
  if (left.length === 0) {
    const tier2 = MILESTONES.filter((m) => m.tier === 2);
    const left2 = tier2.filter((m) => !m.done());
    const mine = left2.length === 0 ? "My mine is done too (coal and iron)" : `Now my mine: still to do ${left2.map((m) => m.title).join(", ")}`;
    return `My first day is done. ${mine}. ${state}.`;
  }
  return `First day: ${done.length} of ${tier1.length} done${done.length ? ` (${done.map((m) => m.title).join(", ")})` : ""}; still to do: ${left.map((m) => m.title).join(", ")}. ${state}.`;
}

/** A new connection: blocked milestones get another chance. */
export function resetCurriculum(): void {
  blockedUntil.clear();
}

// A task ending is a good moment to look at what's next. A milestone given up
// as stuck or too long is set aside for a while, like one that failed.
onTaskEnd((task, outcome) => {
  const why = String(task.signal.reason ?? "");
  if (outcome === "cancelled" && task.name.startsWith(MILESTONE_PREFIX) && (why === "stuck" || why === "took too long")) {
    const m = MILESTONES.find((x) => `${MILESTONE_PREFIX}${x.title}` === task.name);
    if (m) blockedUntil.set(m.id, Date.now() + BLOCKED_FOR_MS);
  }
  setTimeout(() => void considerNextStep(), 1_000);
});

// The owner's own orders get a fresh start: a source that failed during its
// own life (no sheep found) shouldn't block "make me a bed"
onTaskStart((task) => {
  if (task.bucket === Bucket.Owner) clearDemotions();
});
