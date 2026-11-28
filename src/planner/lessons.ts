// Path: src/planner/lessons.ts
// What the bot has learned (its long-term memory beyond day summaries): once
// a game week the model reads its day summaries, its diary and the lessons
// it already has, and writes the list again: the ones still true kept, the
// ones proved wrong dropped, new ones added ("my mine has no iron above
// level 20", "sheep are in the meadow east of home"). Every later plan and
// the owner's chat get them. Like the day plan: one strict function call,
// in the background, never inside a task or a reflex.

import OpenAI from "openai";
import { zodResponsesFunction } from "openai/helpers/zod";
import { z } from "zod";
import { OPENAI_API_KEY } from "../config/env";
import { getMemory, updateMemory } from "../managers/persistenceManager";
import { overBudget, recordCall } from "./cost";
import { gameDay, note, rawDays, renderDay, summaries } from "./diary";

const LESSONS_MODEL = "gpt-6-luna";
const CALL_TIMEOUT_MS = 45_000;
// A game week between rewrites; the first ones once a few days are summarised
export const LESSONS_EVERY_DAYS = 7;
export const FIRST_LESSONS_AFTER_DAYS = 3;
export const MAX_LESSONS = 12;
const MAX_LESSON_CHARS = 200;

export type Lessons = { day: number; items: string[] };

export const LessonsSchema = z.object({
  lessons: z.array(z.string()).describe(`up to ${MAX_LESSONS} lessons, the most useful first, each one short sentence with the concrete fact (a place, a number, a cause)`),
});

/** The standing instructions for the weekly look back (exported for the live check). */
export const SYSTEM = `You are MinecraftGPT, a Minecraft bot living its own life in a survival world. Your code does every action; you choose what to do each day.
Once a week you look back and write down what you have learned, for your own later plans.

Rules:
- Answer by calling submitLessons once, with the whole list written again: keep the lessons that are still true, drop the ones the diary proved wrong or that no longer matter, add new ones.
- A lesson is something that will change a later plan: where things are (coordinates, directions from home), what keeps failing and why, what worked instead, what to do first before a kind of job, what kills you.
- Only what the diary and summaries show. Never general Minecraft knowledge, never a guess.
- Concrete and short: one sentence each, with the place, number or cause. At most ${MAX_LESSONS}.`;

/** The lessons it has now (none before the first week). */
export function lessons(): Lessons | null {
  return (getMemory().lessons as Lessons | undefined) ?? null;
}

/**
 * True when it's time to write its lessons again: a game week since the
 * last time, or, the first time, once a few days have a summary. Pure.
 */
export function lessonsDue(day: number, lastDay: number | null, summarisedDays: number): boolean {
  if (lastDay === null) return summarisedDays >= FIRST_LESSONS_AFTER_DAYS;
  return day - lastDay >= LESSONS_EVERY_DAYS;
}

/** The model's list tidied: trimmed, no empty or repeated ones, each cut to a sentence's length, at most 12. Pure. */
export function cleanLessons(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const text = r.replace(/\s+/g, " ").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text.length > MAX_LESSON_CHARS ? `${text.slice(0, MAX_LESSON_CHARS - 3)}...` : text);
    if (out.length >= MAX_LESSONS) break;
  }
  return out;
}

/** The lessons as lines for a prompt ("" when it has none). */
export function lessonsText(): string {
  return (lessons()?.items ?? []).map((l) => `- ${l}`).join("\n");
}

const lessonsTool = zodResponsesFunction({ name: "submitLessons", description: "What you have learned so far, the whole list.", parameters: LessonsSchema });

/** What the model reads to write its lessons: the old ones, every day summary, the raw diary it still has. */
function lessonsContext(): string {
  const old = lessonsText();
  const memory = summaries().map((s) => `Day ${s.day}: ${s.text}`);
  const raw = rawDays().filter((d) => d.lines.length > 0).map((d) => `Day ${d.day}:\n${renderDay(d)}`);
  return [
    `Today is day ${gameDay()}.`,
    old ? `Your lessons so far:\n${old}` : "You have no lessons written down yet.",
    memory.length ? `Your day summaries:\n${memory.join("\n")}` : "",
    raw.length ? `Your diary, the last days in full:\n${raw.join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

let inFlight = false;

/**
 * Writes its lessons again when it's time (see lessonsDue). In the
 * background, before the dusk plan. True when a new list was saved; a call
 * that fails is tried again at the next dusk.
 */
export async function writeLessonsIfDue(): Promise<boolean> {
  const day = gameDay();
  if (inFlight || overBudget() || !lessonsDue(day, lessons()?.day ?? null, summaries().length)) return false;
  inFlight = true;
  try {
    console.log("Lessons: looking back at what I've learned.");
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const response = await openai.responses.create(
      {
        model: LESSONS_MODEL,
        reasoning: { effort: "medium" },
        instructions: SYSTEM,
        input: lessonsContext(),
        tools: [lessonsTool],
        tool_choice: { type: "function", name: "submitLessons" },
      },
      { timeout: CALL_TIMEOUT_MS, maxRetries: 0 }
    );
    recordCall("lessons", LESSONS_MODEL, response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0);
    const call = response.output.find((o) => o.type === "function_call");
    if (!call || call.type !== "function_call") {
      console.log("Lessons: the model answered without a list.");
      return false;
    }
    const parsed = LessonsSchema.safeParse(JSON.parse(call.arguments));
    if (!parsed.success) {
      console.log(`Lessons: the list didn't match the schema: ${parsed.error.message}`);
      return false;
    }
    const items = cleanLessons(parsed.data.lessons);
    // An empty list keeps the old one (and the day: asked again next week)
    await updateMemory({ lessons: { day, items: items.length > 0 ? items : (lessons()?.items ?? []) } });
    await note(`Looked back at what I've learned: ${items.length} lesson${items.length === 1 ? "" : "s"} written down.`);
    return items.length > 0;
  } catch (error) {
    console.error("Lessons: the call failed; I'll look back again at the next dusk:", error);
    return false;
  } finally {
    inFlight = false;
  }
}
