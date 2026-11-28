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

// The version of the instructions below: lessons written under older ones are
// written again at the next dusk (game test, 2026-11-28: the first list was
// advice with no place or number in it, "make sure a path exists...")
export const LESSONS_VERSION = 2;

export type Lessons = { day: number; items: string[]; v?: number };

export const LessonsSchema = z.object({
  lessons: z.array(z.string()).describe(`up to ${MAX_LESSONS} lessons, the most useful first, each one short sentence with the concrete fact (a place, a number, a cause)`),
});

/** The standing instructions for the weekly look back (exported for the live check). */
export const SYSTEM = `You are MinecraftGPT, a Minecraft bot living its own life in a survival world. Your code does every action; you choose what to do each day.
Once a week you look back and write down what you have learned, for your own later plans.

Rules:
- Answer by calling submitLessons once, with the whole list written again: keep the lessons that are still true, drop the ones the diary proved wrong or that no longer matter, add new ones.
- A lesson is a fact about THIS world that will change a later plan: where something is, what keeps failing at a place and why, what worked instead, what killed you and where.
- Every lesson must carry something concrete taken from the diary or the summaries: coordinates, a direction and distance from home, a count, a time of day, or the name of the thing (the mob, the item, the step of your stairs). Copy the numbers as written.
- A sentence that would be just as true in any Minecraft world is advice, not a lesson: leave it out. Also drop any old lesson like that.
- Only what the diary and summaries show. Never general Minecraft knowledge, never a guess, never a routine you already follow (going home at night, putting things away, checking the furnace).
- Never where you stand in your progress either: which milestones are done or not, what you own or carry, what a plan had in it or left unfinished. Every plan is told those anyway, and they are out of date in a day.
- Fewer is better: three real lessons beat ten thin ones, and an empty list is right when nothing concrete has happened yet. At most ${MAX_LESSONS}, one short sentence each.

Good: "No path from my mine's stairs at 12, 40, -28 to the tunnel at 12, 30, -40: mend the stairs before going for iron." "Sheep are about 120 blocks east of home, by the river." "Died twice to creepers on my mine stairs near step 30 at night." "Two coal trips of 60 blocks found none below level 20; charcoal from logs worked."
Bad (never write these): "Make sure a path exists before traveling." "Prioritize shelter when mobs are near." "Check the furnace after mining." "Keep enough food." "The iron armor milestone is done; skip it." "Mending the mine still needs doing."`;

/** The lessons it has now (none before the first week). */
export function lessons(): Lessons | null {
  return (getMemory().lessons as Lessons | undefined) ?? null;
}

/**
 * True when it's time to write its lessons again: a game week since the
 * last time; the first time, once a few days have a summary; or at once
 * when the list was written under older instructions (`current` false). Pure.
 */
export function lessonsDue(day: number, lastDay: number | null, summarisedDays: number, current = true): boolean {
  if (lastDay === null) return summarisedDays >= FIRST_LESSONS_AFTER_DAYS;
  return !current || day - lastDay >= LESSONS_EVERY_DAYS;
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
  const had = lessons();
  if (inFlight || overBudget() || !lessonsDue(day, had?.day ?? null, summaries().length, (had?.v ?? 1) >= LESSONS_VERSION)) return false;
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
    // The list as the model wrote it again, an empty one too (nothing
    // concrete yet beats advice that fits any world): asked again next week
    await updateMemory({ lessons: { day, items, v: LESSONS_VERSION } });
    await note(`Looked back at what I've learned: ${items.length} lesson${items.length === 1 ? "" : "s"} written down.`);
    return items.length > 0;
  } catch (error) {
    console.error("Lessons: the call failed; I'll look back again at the next dusk:", error);
    return false;
  } finally {
    inFlight = false;
  }
}
