// Path: src/planner/planner.ts
// The day planner (Phase 7): the model as the bot's decision maker at a slow
// cadence. Code builds the context (persona, owner, state, the diary, its
// memory, the feasible-goal menu); the model answers with one strict
// function call (the Responses API with reasoning: Chat Completions refuses
// tools with reasoning for gpt-6-luna); code validates the plan and keeps it
// in world memory, where the curriculum runs it one step at a time in B5.
// Never inside a task, a reflex or a loop: a few calls per game day, guarded.

import OpenAI from "openai";
import { zodResponsesFunction } from "openai/helpers/zod";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { report } from "../core/narrator";
import { OPENAI_API_KEY, OWNER_USERNAME } from "../config/env";
import { recentConversation } from "../core/session";
import { MILESTONES, tier1Reached } from "../skills/milestones";
import { foodPoints, hasBed, shelter, toolTier } from "../skills/capabilities";
import { overBudget, recordCall } from "./cost";
import { gameDay, linesSince, note, rawDays, renderDay, summaries, summarise, type DiaryDay } from "./diary";
import { goalMenu, goalNamed } from "./goals";
import { currentPlan, DayPlanSchema, describePlan, MAX_STEPS, MIN_STEPS, savePlan, validateSteps, type DayPlan, type StoredPlan } from "./plan";
import { PLAN_PREFIX } from "./names";
import { currentRole, describeRole } from "../roles/role";
import { cancelRunning, currentTask, dropPending } from "../core/arbiter";

const PLAN_MODEL = "gpt-6-luna";
// A plan answers in about 5 s; a stalled connection must not hold anything up
// (the SDK's default is 10 minutes with retries)
const CALL_TIMEOUT_MS = 20_000;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

export type Trigger = "dusk" | "idle" | "blocked" | "death" | "owner joined" | "owner asked";

// Guards: one call at a time, never closer than this, and per trigger
const MIN_GAP_MS = 2 * 60_000;
const TRIGGER_GAP_MS: Record<Trigger, number> = {
  dusk: 0, // once per game day (checked by day)
  idle: 10 * 60_000,
  blocked: 5 * 60_000,
  death: 5 * 60_000,
  "owner joined": 10 * 60_000,
  "owner asked": 0,
};
// After a failed call (network, the API), wait before trying again
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;

let inFlight = false;
let lastCallAt = 0;
let lastFailureAt = 0;
const lastByTrigger = new Map<Trigger, number>();
let plannedForDusk = -1;

const SYSTEM = `You are MinecraftGPT, a Minecraft bot living its own life in a survival world. You talk like a friendly, enthusiastic 12-year-old who loves Minecraft.
You are planning your next in-game day. Your code does every action itself (walking, mining, crafting, fighting, eating, sleeping); you only choose WHAT to do, as goals from the menu.

Rules:
- Answer by calling submitDayPlan once.
- ${MIN_STEPS} to ${MAX_STEPS} steps, in order, each a goal from the menu that is possible now. Use the goal's own fields; set every other field to null.
- Item ids are exact Minecraft ids (raw_iron, iron_pickaxe, torch).
- Think like a player: survive first (food, tools, a safe home), then progress (iron, diamonds), and fix what went wrong yesterday.
- Steps that failed recently with a reason will fail again unless something changed: choose something else.
- daySummary: the whole of today so far in 2-4 sentences, for your long-term memory.
- ownerMessage: only if the owner is online and you have news or a suggestion for them; else null. Never a question: living your own life you decide for yourself, the owner won't answer.
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

/** The planning request: everything the model needs, nothing it doesn't (about 3-7k tokens). */
export async function planningContext(trigger: Trigger, ownerRequest: string | null): Promise<string> {
  const p = bot.entity.position;
  const ownerOnline = Object.keys(bot.players ?? {}).some((n) => n.toLowerCase() === OWNER_USERNAME.toLowerCase());
  const lastOwner = [...recentConversation()].reverse().find((t) => t.role === "owner");
  const tiers = (["pickaxe", "axe", "sword"] as const).map((k) => `${k} ${["none", "wood", "gold", "stone", "iron", "diamond"][toolTier(k) + 1] ?? "?"}`).join(", ");
  const done = MILESTONES.filter((m) => m.done()).map((m) => m.id);
  const day = gameDay();
  // Summarised days travel as their summary; only what came after it goes raw
  const summaryOf = (d: number): { text: string; at?: number } | undefined => summaries().find((s) => s.day === d);
  const unsummarised = (d: { day: number; lines: DiaryDay["lines"]; gains?: DiaryDay["gains"] }): DiaryDay => linesSince(d, summaryOf(d.day)?.at ?? 0);
  const todayEntry = rawDays().find((d) => d.day === day);
  const earlierRaw = rawDays()
    .filter((d) => d.day !== day)
    .map(unsummarised)
    .filter((d) => d.lines.length > 0)
    .map((d) => `Day ${d.day}, after its summary:\n${renderDay(d)}`);
  const memory = summaries().filter((s) => s.day !== day).slice(-5).map((s) => `Day ${s.day}: ${s.text}`);
  const todaySummary = summaryOf(day);
  const plan = currentPlan();
  const lastPlan = plan
    ? plan.steps.map((s) => `${s.goal} ${JSON.stringify(s.args)}: ${s.status}${s.reason ? ` (${s.reason})` : ""}`).join("\n")
    : "none";
  const hostile = Object.values(bot.entities ?? {}).filter((e) => e.name && catalog().isHostile(e.name) && e.position.distanceTo(p) < 24).length;
  return [
    `Why you're planning now: ${trigger}.`,
    ownerRequest ? `The owner asks: "${ownerRequest}". Plan around it.` : "",
    `Owner (${OWNER_USERNAME}): ${ownerOnline ? "online" : "offline"}${lastOwner ? `; last said: "${lastOwner.text}"` : ""}.`,
    `State: day ${day}, ${bot.time?.timeOfDay ?? 0} ticks; at ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)} in the ${(bot.game as { dimension?: string }).dimension ?? "overworld"}; health ${Math.round(bot.health ?? 0)}/20, food ${bot.food ?? 0}/20, food carried ${foodPoints()} points; ${hostile} hostile mobs near.`,
    `Tools: ${tiers}. Home: ${shelter() ? "a shelter" : "no shelter"}${hasBed() ? " with a bed" : ""}.`,
    `Your job for the owner: ${describeRole(currentRole())} (it runs on its own, ahead of your plan: plan around it).`,
    `Carrying: ${inventoryLine()}.`,
    `In its chests: ${await chestsLine()}.`,
    `Milestones done: ${done.join(", ") || "none"}.`,
    `Yesterday's plan and how it went:\n${lastPlan}`,
    memory.length ? `Your memory (earlier days):\n${memory.join("\n")}` : "",
    earlierRaw.length ? earlierRaw.join("\n") : "",
    todaySummary ? `Today's earlier summary: ${todaySummary.text}` : "",
    `Today's diary${todaySummary ? " since that summary" : ""}:\n${todayEntry ? renderDay(unsummarised(todayEntry)) || "nothing new" : "nothing yet"}`,
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
    reasoning: { effort: "low" },
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
 * Makes a day plan for this reason, unless a guard says not now. Runs in the
 * background: the bot carries on with upkeep and its fallback meanwhile.
 * True when a new plan was saved.
 */
export async function planDay(trigger: Trigger, ownerRequest: string | null = null): Promise<boolean> {
  const now = Date.now();
  if (inFlight || !bot.entity) return false;
  if (overBudget()) {
    console.log("Planner: this month's budget is spent; following my milestones.");
    return false;
  }
  if (trigger !== "owner asked") {
    if (now - lastCallAt < MIN_GAP_MS || now - lastFailureAt < RETRY_AFTER_FAILURE_MS) return false;
    if (now - (lastByTrigger.get(trigger) ?? 0) < TRIGGER_GAP_MS[trigger]) return false;
  }
  inFlight = true;
  lastCallAt = now;
  lastByTrigger.set(trigger, now);
  try {
    console.log(`Planner: planning the day (${trigger}).`);
    const plan = await askModel(await planningContext(trigger, ownerRequest));
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
    // The old plan's step stops now (owner: "skip mining today" means now)
    dropPending((t) => t.name.startsWith(PLAN_PREFIX));
    const running = currentTask();
    if (running?.name.startsWith(PLAN_PREFIX)) await cancelRunning("a new plan", false);
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
    lastFailureAt = Date.now();
    console.error("Planner: the planning call failed; following my milestones for now:", error);
    return false;
  } finally {
    inFlight = false;
  }
}

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

/** Marks today's dusk as planned (whether or not the call worked: once a day). */
export function markDuskPlanned(): void {
  plannedForDusk = gameDay();
}

/** A new connection: guards start fresh (the plan itself is in world memory). */
export function resetPlanner(): void {
  inFlight = false;
  lastFailureAt = 0;
  lastByTrigger.clear();
}
