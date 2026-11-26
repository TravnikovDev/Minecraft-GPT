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

import { noteMilestone, noteMilestoneFailed } from "../planner/diaryHooks";
import { automationAllowed } from "../config/serverProfile";
import { ENDGAME_NIGHT_OK } from "./endgame/milestones";
import { PLAN_PREFIX, setStepGate, stepAllowedNow } from "../planner/names";
import { bot, isOnline } from "../core/body";
import { Bucket, cancelRunning, type TaskSpec, currentTask, dropPending, onTaskEnd, onTaskStart, pendingTasks, propose } from "../core/arbiter";
import { areChoresMuted } from "../core/chores";
import { isCommandCancelled } from "../core/commandContext";
import { chatter, report } from "../core/narrator";
import { setSheltered } from "../core/sheltered";
import { describeFailure, fail } from "../core/result";
import { getMemory, updateMemory } from "../managers/persistenceManager";
import { MILESTONES, milestoneHere, nextMilestone, noteReached, smeltIronAndMakePickaxe, tier1Reached, type Milestone } from "./milestones";
import { hasBed, shelter, TIER, toolTier } from "./capabilities";
import { buildShelter, enterShelter, leaveShelter, shelterIntact } from "../actions/building";
import { clearDemotions } from "./acquire";
import { daylight } from "../core/daylight";

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
  (task.bucket === Bucket.Self && (task.name.startsWith(MILESTONE_PREFIX) || task.name.startsWith(PLAN_PREFIX))) || task.name === NIGHT_NAME;
const blockedUntil = new Map<string, number>();
// Failures in a row per milestone: each one sets it aside twice as long, up
// to half an hour (review: one it could never do came back every 2 minutes
// all day, walking out and back each time). Done, it starts over.
const failuresInRow = new Map<string, number>();
const MAX_BLOCKED_MS = 32 * 60_000;

/** How long a milestone is set aside after its `n`th failure in a row (n >= 1). Pure. */
export function setAsideFor(n: number): number {
  return Math.min(BLOCKED_FOR_MS * 2 ** Math.max(0, n - 1), MAX_BLOCKED_MS);
}

/** Sets a milestone aside after a failure; how long, in ms. */
function setAside(id: string): number {
  const n = (failuresInRow.get(id) ?? 0) + 1;
  failuresInRow.set(id, n);
  const ms = setAsideFor(n);
  blockedUntil.set(id, Date.now() + ms);
  return ms;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** True when the owner let it live its own life. */
export function autonomyOn(): boolean {
  // A server that forbids bots acting on their own: never (server courtesy)
  if (!automationAllowed()) return false;
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
  // From sunset to dawn, in the overworld only (the Nether and the End have
  // no night: its shelter is in the overworld); one clock for all (review)
  return !daylight();
};

/** Announces milestones reached for the first time. */
async function announce(): Promise<void> {
  for (const m of await noteReached()) {
    const done = MILESTONES.filter((x) => x.tier === m.tier && x.done()).length;
    const total = MILESTONES.filter((x) => x.tier === m.tier).length;
    const towards = ["", "for my first day", "for my mine", "for iron and diamonds", "for the Nether", "for the End"][m.tier] ?? "";
    report(`Milestone: ${m.title} (${done} of ${total} ${towards}).`);
    noteMilestone(m.title);
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
      let result = await m.achieve();
      await announce();
      // "Done" without being done is a failure too (review: it was proposed
      // again every second)
      if (result.ok && !m.done() && !isCommandCancelled()) result = fail("refused", `${m.title} still isn't done`);
      if (m.done()) failuresInRow.delete(m.id);
      if (!result.ok && !isCommandCancelled()) {
        const ms = setAside(m.id);
        const why = describeFailure(result);
        noteMilestoneFailed(m.title, why);
        if (why === lastFailureSaid.why && Date.now() - lastFailureSaid.at < MAX_BLOCKED_MS) {
          console.log(`Couldn't get ${m.title} either: ${why} (again in ${Math.round(ms / 60_000)} min).`);
        } else {
          const minutes = Math.round(ms / 60_000);
          report(`I couldn't get ${m.title} yet: ${why}. I'll try again in ${minutes <= 2 ? "a couple of" : minutes} minutes.`);
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
const NIGHT_TRIES = 4;
const BED_RETRY_MS = 10_000;

/** Shut in with raw iron, a furnace and fuel: smelts it and makes an iron pickaxe (once it has none). */
async function smeltAtNight(): Promise<void> {
  const raw = bot.inventory.items().filter((i) => i.name === "raw_iron").reduce((n, i) => n + i.count, 0);
  if (raw === 0 || toolTier("pickaxe") >= TIER.iron) return;
  try {
    const made = await smeltIronAndMakePickaxe();
    if (!made.ok) console.log(`Night: no iron pickaxe yet (${describeFailure(made)}).`);
  } catch (error) {
    console.log(`Night: smelting failed: ${(error as Error).message}`);
  }
}
const NIGHT_RETRY_MS = 60_000;
// A night routine that failed: proposed again from this time (0: no retry due)
let nightRetryAt = 0;
let lastNightReport = "";

/** Says a night failure once, not every retry. */
function reportOnce(text: string): void {
  if (text === lastNightReport) return console.log(text);
  lastNightReport = text;
  report(text);
}

/**
 * Shut in for the night with raw meat and the shelter's furnace: cooks it,
 * like a player using the dark hours (owner). Fuel is what it carries (coal,
 * charcoal, planks, logs); without any it just waits.
 */
async function cookAtNight(): Promise<void> {
  const { cookFood, rawFoodInInventory } = await import("../actions/cooking");
  if (rawFoodInInventory().length === 0) return;
  try {
    const cooked = await cookFood();
    if (cooked === null) console.log("Night: raw meat to cook, but no furnace or fuel at hand.");
    else if (cooked > 0) chatter(`Cooked ${cooked} food in my furnace for tomorrow.`, "night");
  } catch (error) {
    console.log(`Night: cooking failed: ${(error as Error).message}`);
  }
}

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
      // No shelter: dig one. A hole or a missing door: mend it as well as it
      // can, then in anyway (a door it can't make in the dark must never
      // leave it outside; the doorway gets blocks then)
      if (!shelter()) {
        const dug = await buildShelter();
        if (!dug.ok) {
          reportOnce(`I couldn't dig a shelter for the night: ${describeFailure(dug)}.`);
          nightRetryAt = Date.now() + NIGHT_RETRY_MS;
          return;
        }
      } else if (!shelterIntact()) {
        const mended = await buildShelter();
        if (!mended.ok) console.log(`Night: couldn't fully mend my shelter (${describeFailure(mended)}); going in anyway.`);
      }
      // Getting in: a few tries (a walk can fail once; giving up left it
      // standing outside all night, fresh-world test)
      let inside = await enterShelter();
      for (let tries = 1; !inside.ok && tries < NIGHT_TRIES && isNight() && !isCommandCancelled(); tries++) {
        console.log(`Night: couldn't get into my shelter (${describeFailure(inside)}); trying again.`);
        await sleep(3_000);
        inside = await enterShelter();
      }
      if (!inside.ok) {
        // Down in its mine with mine work to do: it stays and works the night
        // through (under ground the night doesn't matter), rather than trying
        // to climb out again and again
        if (mineWorkTonight() && bot.entity.position.y < (shelter()?.y ?? 0) - 2) {
          reportOnce(`I can't get back up to my shelter (${describeFailure(inside)}); working on in my mine tonight.`);
          return;
        }
        reportOnce(`I couldn't get into my shelter: ${describeFailure(inside)}.`);
        // Again in a minute, not only next night (and not every few seconds)
        nightRetryAt = Date.now() + NIGHT_RETRY_MS;
        return;
      }
      // Shut in: the reflexes leave what's outside alone until morning
      setSheltered(true);
      try {
        await cookAtNight();
        // Leather from the day's hunts: armour for the slots it has nothing in
        // (best effort: the night goes on whatever happens)
        try {
          await (await import("./leatherArmor")).makeLeatherArmor();
        } catch (error) {
          console.log(`Night: leather armour failed: ${(error as Error).message}`);
        }
        // Indoor work: raw iron smelted in the furnace and made into an iron
        // pickaxe (owner: it stood at home all night doing nothing)
        await smeltAtNight();
        // The workshop: its furnace loaded with the ores in its chests (owner)
        try {
          await (await import("./workshop")).workshop();
        } catch (error) {
          console.log(`Night: workshop failed: ${(error as Error).message}`);
        }
        // The room's walls lit (the ground outside waits for the morning)
        try {
          await (await import("./lighting")).lightUpHome(false);
        } catch (error) {
          console.log(`Night: lighting the room failed: ${(error as Error).message}`);
        }
        // Mine work to do: on through the back door, mining all night (the
        // milestone is proposed as soon as this routine ends)
        if (mineWorkTonight()) {
          chatter("Night: carrying on in my mine.", "night");
          return;
        }
        // Wait for the morning in bed: at dusk the bed says "not yet", so it
        // tries again every few seconds until it sleeps
        const { execute: sleepInBed } = await import("../commands/Sleep");
        let lastTry = 0;
        while (isNight() && !isCommandCancelled()) {
          if (hasBed() && !bot.isSleeping && Date.now() - lastTry > BED_RETRY_MS) {
            lastTry = Date.now();
            await sleepInBed({ newBed: false });
          }
          await sleep(2_000);
        }
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
  // Dusk: tomorrow is planned now, busy or not (the night routine starts at
  // dusk and runs till dawn: checked after it, this never fired)
  await planAtDusk();
  // Night comes first: it cuts in on a milestone (upkeep outranks "self"),
  // but waits for the owner's commands
  // The world's day (it moves on when someone sleeps; the age doesn't)
  const day = bot.time?.day ?? 0;
  const retryDue = nightRetryAt > 0 && Date.now() >= nightRetryAt;
  if (isNight() && !bot.isSleeping && (nightOf !== day || retryDue) && !busyWith(Bucket.Upkeep)) {
    nightOf = day;
    nightRetryAt = 0;
    propose(nightTask());
    return;
  }
  if (busyWith(Bucket.Self)) return;
  // Past its first day the day plan decides what's next (Phase 7); with no
  // plan step to do (not made yet, the model unavailable, the money spent)
  // the next milestone below is the fallback
  if (await planStepProposed()) return;
  // At night only work underground, and only once it's home (the night
  // routine ran: in through the shelter, doors shut): in the mine day and
  // night are the same, it only needs torches (owner)
  if (isNight()) {
    const tonight = nightOf === day ? nextNightMilestone() : null;
    if (tonight) propose(milestoneTask(tonight));
    // Its mine work done (or blocked) and the night not over: back home to
    // bed, not standing about in the mine or by the back door till morning
    // (review). Not while a failed night routine waits for its retry.
    else if (nightOf === day && nightRetryAt === 0 && !bot.isSleeping) propose(nightTask());
    return;
  }
  const next = nextMilestone(MILESTONES, isBlocked);
  if (next) propose(milestoneTask(next));
}

/** Plan steps that make sense at night: under ground, like its night milestones. */
const nightStep = (goal: string, args: Record<string, unknown>): boolean =>
  goal === "mineFor" || (goal === "reachMilestone" && UNDERGROUND.has(String(args["milestone"])));

/**
 * The day plan's part in choosing what's next: plans at dusk (once a game
 * day) and when it has no steps left, and proposes the next step. True when
 * it proposed one.
 */
async function planStepProposed(): Promise<boolean> {
  const { planningOn, planDay } = await import("../planner/planner");
  if (!planningOn(autonomyOn())) return false;
  const { nextStep } = await import("../planner/plan");
  const { planStepTask } = await import("../planner/runner");
  const next = nextStep();
  if (!next) {
    void planDay("idle");
    return false;
  }
  // A step that waits for the morning doesn't hold the night up: the night
  // milestones go on meanwhile (game test: the plan's "resting at home" step
  // waited all night; it said "carrying on in my mine" and only replanted
  // and tidied till dawn)
  if (!stepAllowedNow(next.step)) return false;
  const task = planStepTask(next.planId, next.index);
  if (!task) return false;
  propose(task);
  return true;
}

/** Dusk: plan tomorrow, once per game day, whatever it's doing. */
async function planAtDusk(): Promise<void> {
  const { planningOn, planDay, duskDue, markDuskPlanned, sharePlanIfQuiet } = await import("../planner/planner");
  if (!planningOn(autonomyOn())) return;
  sharePlanIfQuiet(); // the owner online but quiet: tell them the plan once
  if (!duskDue()) return;
  markDuskPlanned();
  void planDay("dusk");
}

// At night a plan step runs only under ground, and only once it's home (the
// night routine ran), like its night milestones; resumed steps are checked too
setStepGate((step) => !isNight() || (nightStep(step.goal, step.args) && nightOf === (bot.time?.day ?? 0)));

/** Milestones done in the mine or inside the shelter (smelting, the iron pickaxe), where night doesn't matter. */
// Worked on at night: in its mine, or at home (crafting, smelting: the iron
// for a shield or a bucket comes from the mine). Game test: the shield and
// the bucket were missing here, so the night after its iron pickaxe it had
// "no mine work" and stood by a bed it couldn't use (monsters outside) all night
const UNDERGROUND = new Set(["mine", "coal", "torches", "iron", "iron_pickaxe", "iron_sword", "shield", "bucket", "iron_armor", "iron_tools", "paved_stairs", "diamonds", "diamond_pickaxe", ...ENDGAME_NIGHT_OK]);

/** True when a milestone is worked on at night (under ground or at home). */
export const worksAtNight = (id: string): boolean => UNDERGROUND.has(id);

/** Mine work it could do now (the next milestone is one underground). */
/**
 * The next milestone it can work on at night: the first open one of those
 * (in its mine or at home); daytime work (lighting the ground round its
 * home, food) waits for the morning without holding the night up.
 */
function nextNightMilestone(): Milestone | null {
  return nextMilestone(MILESTONES, isBlocked, (m) => milestoneHere(m) && UNDERGROUND.has(m.id));
}

function mineWorkTonight(): boolean {
  return nextNightMilestone() !== null;
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
  failuresInRow.clear();
}

// A task ending is a good moment to look at what's next. A milestone given up
// as stuck or too long is set aside for a while, like one that failed.
onTaskEnd((task, outcome) => {
  const why = String(task.signal.reason ?? "");
  if (outcome === "cancelled" && task.name.startsWith(MILESTONE_PREFIX) && (why === "stuck" || why === "took too long")) {
    const m = MILESTONES.find((x) => `${MILESTONE_PREFIX}${x.title}` === task.name);
    if (m) setAside(m.id);
  }
  setTimeout(() => void considerNextStep(), 1_000);
});

// The owner's own orders get a fresh start: a source that failed during its
// own life (no sheep found) shouldn't block "make me a bed"
onTaskStart((task) => {
  if (task.bucket === Bucket.Owner) clearDemotions();
});
