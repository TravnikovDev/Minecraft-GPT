// Path: src/planner/planner.ts
// The day planner (Phase 7): the model as the bot's decision maker at a slow
// cadence. Code builds the context (persona, owner, state, the diary, its
// memory, the feasible-goal menu); the model answers with one strict
// function call (the Responses API with reasoning: Chat Completions refuses
// tools with reasoning for gpt-6-luna); code validates the plan and keeps it
// in world memory, where the curriculum runs it one step at a time in B5.
// Never inside a task, a reflex or a loop: a few calls per game day, guarded.
// It thinks properly about each plan (medium reasoning) and reads all it
// remembers: every day summary it keeps, the last days' diary in full, its
// own lessons (planner/lessons) and what failed today (planner/failures).
// A failure asks for a new plan at once, with the exact reason, so the model
// decides what to do about it; its own life waits the few seconds that takes.

import OpenAI from "openai";
import { zodResponsesFunction } from "openai/helpers/zod";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { report } from "../core/narrator";
import { OPENAI_API_KEY, OWNER_USERNAME } from "../config/env";
import { recentConversation } from "../core/session";
import { MILESTONES, tier1Reached } from "../skills/milestones";
import { foodPoints, hasBed, shelter, toolTier } from "../skills/capabilities";
import { overBudget, planningPaced, recordCall } from "./cost";
import { gameDay, note, partOfDay, rawDays, renderDay, summaries, summarise } from "./diary";
import { failureLine, failuresToday, MAX_SAME_FAILURES, nextBlockedGapMs, noteBlockedPlan, takeFreshFailure, type FailureNote } from "./failures";
import { lessonsText, writeLessonsIfDue } from "./lessons";
import { goalMenu, goalNamed } from "./goals";
import { currentPlan, DayPlanSchema, describePlan, MAX_STEPS, MIN_STEPS, savePlan, validateSteps, type DayPlan, type StoredPlan } from "./plan";
import { PLAN_PREFIX } from "./names";
import { currentRole, describeRole } from "../roles/role";
import { cancelRunning, currentTask, dropPending } from "../core/arbiter";

const PLAN_MODEL = "gpt-6-luna";
// A plan thought over properly answers in 10 to 20 s; a stalled connection
// must not hold anything up (the SDK's default is 10 minutes with retries)
const CALL_TIMEOUT_MS = 45_000;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

export type Trigger = "dusk" | "idle" | "blocked" | "death" | "owner joined" | "owner asked";

// Guards: one call at a time, never closer than this, and per trigger
const MIN_GAP_MS = 60_000;
const TRIGGER_GAP_MS: Record<Trigger, number> = {
  dusk: 0, // once per game day (checked by day)
  idle: 3 * 60_000,
  // At once after a failure, then longer each time in a row with nothing
  // done in between (planner/failures: 1, 2, 4... up to 15 minutes)
  blocked: 0,
  death: 60_000,
  "owner joined": 5 * 60_000,
  "owner asked": 0,
};
// The backstop under all of them: its own plans in any one hour (the owner's
// asking is never counted out). A normal hour makes a handful; a day when
// everything fails must not spend the month's money
export const PLANS_PER_HOUR = 20;
let recentPlans: number[] = [];

/** The plan times still inside the last hour, and whether one more fits. Pure. */
export function hourlyRoom(times: number[], now: number, max = PLANS_PER_HOUR): { kept: number[]; room: boolean } {
  const kept = times.filter((t) => now - t < 60 * 60_000);
  return { kept, room: kept.length < max };
}

// After a failed call (network, the API), wait before trying again
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;

let inFlight = false;
// What the call in flight is for (null: none)
let planningFor: Trigger | null = null;
let lastCallAt = 0;
let lastFailureAt = 0;
const lastByTrigger = new Map<Trigger, number>();
let plannedForDusk = -1;

/** The planner's standing instructions (exported for the live check of the plan format). */
export const SYSTEM = `You are MinecraftGPT, a Minecraft bot living its own life in a survival world. You talk like a friendly, enthusiastic 12-year-old who loves Minecraft.
You are planning your next in-game day. Your code does every action itself (walking, mining, crafting, fighting, eating, sleeping); you only choose WHAT to do, as goals from the menu.

Rules:
- Answer by calling submitDayPlan once.
- ${MIN_STEPS} to ${MAX_STEPS} steps, in order, each a goal from the menu that is possible now. Use the goal's own fields; set every other field to null.
- Item ids are exact Minecraft ids (raw_iron, iron_pickaxe, torch).
- Think like a player: survive first (food, tools, a safe home), then progress (iron, diamonds), and fix what went wrong.
- Use your lessons and your memory of earlier days: don't repeat what they say doesn't work, and go where they say things are.
- When something just failed, decide what to do about it like a player would: fix the cause first (a tool, food, torches, a trip home, mending your mine), get the same thing another way, leave it for later in the day after other steps, or drop it for today. Put the same step in again only if an earlier step of this plan changes what made it fail.
- A step that failed ${MAX_SAME_FAILURES} times today is off until tomorrow: don't plan it.
- At night you work on as by day until a mob attacks you; from then until morning only work under ground runs (mineFor, mendMine, the mine's milestones) and the other steps wait. Fishing always waits for daylight.
- A failure marked as a wait (you were hurt or hungry, or it was refused at night) is no failure of the job: plan food or rest first if that's the cause, and the job again after.
- daySummary: the whole of today so far in 2-4 sentences, for your long-term memory.
- ownerMessage: only if the owner is online and you have real news for them that your narrative doesn't already say (something found, lost, finished, or a danger); else null. Never the plan again, never a question: living your own life you decide for yourself, the owner won't answer.
- A step marked "running" in your last plan is being done right now and is finished before your new plan starts: leave it out unless you want more of the same after it.
- narrative: one or two sentences in character, shown to the owner.`;

/** What it carries, by name, the most first (a short list). */
function inventoryLine(): string {
  const counts = new Map<string, number>();
  for (const i of bot.inventory?.items() ?? []) counts.set(i.name, (counts.get(i.name) ?? 0) + i.count);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, c]) => `${c} ${n}`).join(", ") || "nothing";
}

/** What its own chests hold (as last seen), the most first. */
async function chestsLine(): Promise<string> {
  const { loadChests } = await import("../core/session");
  const counts = new Map<string, number>();
  for (const c of loadChests()) for (const [n, k] of Object.entries(c.contents ?? {})) counts.set(n, (counts.get(n) ?? 0) + k);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([n, c]) => `${c} ${n}`).join(", ") || "nothing known";
}

/**
 * The planning request: everything it knows that bears on the day (about
 * 4-10k tokens): its state, what just failed and what failed today, its
 * lessons, every day summary it keeps, the last days' diary in full, the
 * last plan with how each step went, and the goal menu.
 */
export async function planningContext(trigger: Trigger, ownerRequest: string | null, failure: FailureNote | null = null): Promise<string> {
  const p = bot.entity.position;
  const ownerOnline = Object.keys(bot.players ?? {}).some((n) => n.toLowerCase() === OWNER_USERNAME.toLowerCase());
  const lastOwner = [...recentConversation()].reverse().find((t) => t.role === "owner");
  const tiers = (["pickaxe", "axe", "sword"] as const).map((k) => `${k} ${["none", "wood", "gold", "stone", "iron", "diamond"][toolTier(k) + 1] ?? "?"}`).join(", ");
  const done = MILESTONES.filter((m) => m.done()).map((m) => m.id);
  const day = gameDay();
  const todayEntry = rawDays().find((d) => d.day === day);
  // The days it still has line by line go in full (a summary alone lost the
  // reasons things failed); every older day it remembers as its summary
  const earlierRaw = rawDays()
    .filter((d) => d.day !== day && d.lines.length > 0)
    .map((d) => `Day ${d.day} in full:\n${renderDay(d)}`);
  const memory = summaries().filter((s) => s.day !== day).map((s) => `Day ${s.day}: ${s.text}`);
  const todaySummary = summaries().find((s) => s.day === day);
  const learned = lessonsText();
  const failed = failuresToday();
  const plan = currentPlan();
  const lastPlan = plan
    ? plan.steps.map((s) => `${s.goal} ${JSON.stringify(s.args)}: ${s.status}${s.reason ? ` (${s.reason})` : ""}`).join("\n")
    : "none";
  const hostile = Object.values(bot.entities ?? {}).filter((e) => e.name && catalog().isHostile(e.name) && e.position.distanceTo(p) < 24).length;
  const timeOfDay = bot.time?.timeOfDay ?? 0;
  return [
    `Why you're planning now: ${trigger}${trigger === "blocked" ? " (something just failed: decide what to do about it)" : ""}.`,
    failure ? `What just went wrong: ${failureLine(failure)}.` : "",
    failed.length > (failure ? 1 : 0) ? `Everything that failed today:\n${failed.map((f) => `- ${failureLine(f)}`).join("\n")}` : "",
    ownerRequest ? `The owner asks: "${ownerRequest}". Plan around it.` : "",
    `Owner (${OWNER_USERNAME}): ${ownerOnline ? "online" : "offline"}${lastOwner ? `; last said: "${lastOwner.text}"` : ""}.`,
    `State: day ${day}, the ${partOfDay(timeOfDay)} (${timeOfDay} ticks); at ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)} in the ${(bot.game as { dimension?: string }).dimension ?? "overworld"}; health ${Math.round(bot.health ?? 0)}/20, food ${bot.food ?? 0}/20, food carried ${foodPoints()} points; ${hostile} hostile mobs near.`,
    `Tools: ${tiers}. Home: ${shelter() ? "a shelter" : "no shelter"}${hasBed() ? " with a bed" : ""}.`,
    `Your job for the owner: ${describeRole(currentRole())} (it runs on its own, ahead of your plan: plan around it).`,
    `Carrying: ${inventoryLine()}.`,
    `In its chests: ${await chestsLine()}.`,
    `Milestones done: ${done.join(", ") || "none"}.`,
    `Your last plan and how it went:\n${lastPlan}`,
    learned ? `What you've learned (your own lessons):\n${learned}` : "",
    memory.length ? `Your memory (earlier days):\n${memory.join("\n")}` : "",
    earlierRaw.length ? earlierRaw.join("\n\n") : "",
    todaySummary ? `Your summary of today so far (write it again with what's new): ${todaySummary.text}` : "",
    `Today's diary in full:\n${todayEntry ? renderDay(todayEntry) || "nothing yet" : "nothing yet"}`,
    `Goal menu (what's possible now):\n${goalMenu()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const planTool = zodResponsesFunction({
  name: "submitDayPlan",
  description: "Your plan for the next in-game day.",
  parameters: DayPlanSchema,
});

/** Asks the model for a day plan. Null when it couldn't (no money left, the API, a bad answer). */
async function askModel(context: string): Promise<DayPlan | null> {
  const response = await openai.responses.create({
    model: PLAN_MODEL,
    reasoning: { effort: "medium" },
    instructions: SYSTEM,
    input: context,
    tools: [planTool],
    tool_choice: { type: "function", name: "submitDayPlan" },
  }, { timeout: CALL_TIMEOUT_MS, maxRetries: 0 });
  recordCall("plan", PLAN_MODEL, response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0);
  const call = response.output.find((o) => o.type === "function_call");
  if (!call || call.type !== "function_call") {
    console.log("Planner: the model answered without a plan.");
    return null;
  }
  const parsed = DayPlanSchema.safeParse(JSON.parse(call.arguments));
  if (!parsed.success) {
    console.log(`Planner: the plan didn't match the schema: ${parsed.error.message}`);
    return null;
  }
  return parsed.data;
}

/** True when it plans at all: living its own life, past its first day, money left. */
export function planningOn(autonomy: boolean): boolean {
  return autonomy && tier1Reached() && !overBudget();
}

/**
 * Whether a new plan stops the old plan's step that's running: only when the
 * owner asked for the plan ("skip mining today" means now). Its own plans
 * (dusk, the owner joining) let the step finish first (game test: the dusk
 * plan called it home from 51 steps down its mine, in the middle of a trip
 * for 24 raw iron). Pure.
 */
export const stopsRunningStep = (trigger: Trigger): boolean => trigger === "owner asked";

// A new connection starts a new generation: a call still in flight from the
// old one is let finish, but its answer is dropped (it must not save a plan
// or cancel a task in the new session, or end the new session's hold)
let generation = 0;
// The call in flight, so the owner's request can wait for it instead of being dropped
let callInFlight: Promise<boolean> | null = null;
let lastPacedLogAt = 0;

/**
 * Makes a day plan for this reason, unless a guard says not now. Runs in the
 * background: the bot carries on with upkeep and its fallback meanwhile.
 * True when a new plan was saved.
 */
export async function planDay(trigger: Trigger, ownerRequest: string | null = null): Promise<boolean> {
  if (inFlight) {
    // The owner's request is never dropped for a call in flight (they're
    // frequent now): it waits for that answer, then plans around the request
    if (trigger !== "owner asked" || !callInFlight) return false;
    await callInFlight.catch(() => false);
    if (inFlight) return false;
  }
  const now = Date.now();
  if (!bot.entity) return false;
  if (overBudget()) {
    console.log("Planner: this month's budget is spent; following my milestones.");
    return false;
  }
  if (trigger !== "owner asked") {
    if (now - lastCallAt < MIN_GAP_MS || now - lastFailureAt < RETRY_AFTER_FAILURE_MS) return false;
    // After a failure, and with its plan run out: longer each time in a row
    // that nothing got done (a day when nothing works must not ask all day)
    const gap = trigger === "blocked" ? nextBlockedGapMs() : trigger === "idle" ? Math.max(TRIGGER_GAP_MS.idle, nextBlockedGapMs()) : TRIGGER_GAP_MS[trigger];
    if (now - (lastByTrigger.get(trigger) ?? 0) < gap) return false;
    // Its share of the month's money so far is spent: its milestones till
    // tomorrow (the owner's asking and the owner's chat go on)
    if (planningPaced(now)) {
      if (now - lastPacedLogAt > 60 * 60_000) console.log("Planner: my plans have used their share of the month's budget so far; following my milestones till tomorrow.");
      lastPacedLogAt = now;
      return false;
    }
    const hour = hourlyRoom(recentPlans, now);
    recentPlans = hour.kept;
    if (!hour.room) {
      console.log(`Planner: ${PLANS_PER_HOUR} plans in the last hour; following my milestones for a while.`);
      return false;
    }
  }
  recentPlans.push(now);
  inFlight = true;
  planningFor = trigger;
  lastCallAt = now;
  lastByTrigger.set(trigger, now);
  if (trigger === "blocked") noteBlockedPlan();
  // Dusk is planned once a call really starts (asked for all through dusk until then)
  if (trigger === "dusk") markDuskPlanned();
  const mine = generation;
  callInFlight = makePlan(trigger, ownerRequest, mine).finally(() => {
    if (mine !== generation) return; // a new connection began meanwhile: its state isn't this call's
    inFlight = false;
    planningFor = null;
    callInFlight = null;
  });
  return callInFlight;
}

/** The call itself and what follows from its answer (planDay's guards passed). */
async function makePlan(trigger: Trigger, ownerRequest: string | null, mine: number): Promise<boolean> {
  const stale = (): boolean => mine !== generation;
  try {
    // Once a game week, at dusk: what it has learned, written again first
    // (the plan made right after reads the new list)
    if (trigger === "dusk") await writeLessonsIfDue();
    if (stale() || !bot.entity) return false;
    console.log(`Planner: planning the day (${trigger}).`);
    const plan = await askModel(await planningContext(trigger, ownerRequest, takeFreshFailure()));
    if (stale() || !bot.entity) {
      console.log("Planner: reconnected while planning; that answer is dropped.");
      return false;
    }
    if (!plan) {
      lastFailureAt = Date.now();
      return false;
    }
    const today = gameDay();
    await summarise(today, plan.daySummary);
    const { accepted, rejected } = validateSteps(plan.steps);
    for (const r of rejected) await note(`Left out of my plan: ${r.step} (${r.why}).`);
    // Nothing it can do in it: a failed plan (back off), not an empty one to announce
    if (accepted.length === 0) {
      lastFailureAt = Date.now();
      console.log("Planner: no step of the plan is possible now; following my milestones.");
      return false;
    }
    const before = currentPlan();
    const id = Date.now();
    // Planned at dusk or at night: it's tomorrow's plan
    const forDay = trigger === "dusk" || (bot.time?.timeOfDay ?? 0) >= 12000 ? today + 1 : today;
    const stored: StoredPlan = { id, madeAt: id, day: forDay, narrative: plan.narrative.trim(), steps: accepted };
    await savePlan(stored);
    // The old plan's steps still waiting are dropped. The one running stops
    // only for the owner's request; for its own plans it finishes first and
    // the new plan starts after it (the step knows its plan is gone: it
    // writes nothing in the new one, and isn't resumed if something cuts in)
    dropPending((t) => t.name.startsWith(PLAN_PREFIX));
    const running = currentTask();
    if (running?.name.startsWith(PLAN_PREFIX)) {
      if (stopsRunningStep(trigger)) await cancelRunning("a new plan", false);
      else console.log(`Planner: ${running.name.slice(PLAN_PREFIX.length)} is finished first; the new plan starts after it.`);
    }
    await note(`Planned: ${accepted.map((s) => goalNamed(s.goal)?.describe(s.args) ?? s.goal).join(", ")}.`);
    // Said only when it changed (an idle re-plan of the same steps stays quiet)
    const sig = (p: StoredPlan | null): string => JSON.stringify(p?.steps.filter((x) => x.status === "pending").map((x) => [x.goal, x.args]) ?? []);
    if (trigger === "owner asked" || sig(before) !== sig(stored)) {
      report(describePlan(stored));
      if (ownerOnline()) sharedPlanId = id; // the owner heard it
    }
    if (plan.ownerMessage) report(plan.ownerMessage);
    return true;
  } catch (error) {
    if (!stale()) lastFailureAt = Date.now();
    console.error("Planner: the planning call failed; following my milestones for now:", error);
    return false;
  }
}

/**
 * True while it thinks over a failure, or what to do now its plan has run
 * out (the call is in flight, seconds): its own life starts nothing new till
 * the answer, like a player who stops to think, rather than walking off to
 * the next job. Game test, 2026-11-28: with its plan done, the fallback
 * milestone (diamonds) started in the 10 seconds the model took, and the new
 * plan then waited behind it for the rest of the day.
 */
export const thinkingItOver = (): boolean => inFlight && (planningFor === "blocked" || planningFor === "idle");

// The plan the owner has heard about (told when they're online)
let sharedPlanId: number | null = null;
// Quiet this long while online: the bot tells its plan once
const QUIET_BEFORE_SHARING_MS = 5 * 60_000;

const ownerOnline = (): boolean => Object.keys(bot.players ?? {}).some((n) => n.toLowerCase() === OWNER_USERNAME.toLowerCase());

/**
 * The owner online but quiet, and a plan they haven't heard (made while
 * they were away): tells it once ("Today I want to mine iron..."), with
 * what's left of it. True when it said it.
 */
export function sharePlanIfQuiet(now = Date.now()): boolean {
  const plan = currentPlan();
  if (!plan || !ownerOnline() || overBudget()) return false;
  const id = plan.id ?? plan.madeAt;
  if (id === sharedPlanId || !plan.steps.some((s) => s.status === "pending")) return false;
  const lastOwner = [...recentConversation()].reverse().find((t) => t.role === "owner");
  if (lastOwner && now - lastOwner.at < QUIET_BEFORE_SHARING_MS) return false;
  sharedPlanId = id;
  report(describePlan(plan));
  return true;
}

/** Dusk: plan tomorrow, once per game day (planning never waits for sleep). */
export function duskDue(): boolean {
  const t = bot.time?.timeOfDay ?? 0;
  return t >= 12000 && t < 13800 && plannedForDusk !== gameDay();
}

/** Marks today's dusk as planned (once a call really started, whether or not it works: once a day). */
function markDuskPlanned(): void {
  plannedForDusk = gameDay();
}

/** A new connection: guards start fresh (the plan itself is in world memory). */
export function resetPlanner(): void {
  generation++; // a call still in flight belongs to the old connection: its answer is dropped
  inFlight = false;
  planningFor = null;
  callInFlight = null;
  lastFailureAt = 0;
  lastByTrigger.clear();
}
