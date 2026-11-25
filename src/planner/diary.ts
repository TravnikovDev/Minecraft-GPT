// Path: src/planner/diary.ts
// The bot's diary (Phase 7), written by code, never by the model: each thing
// worth remembering becomes one short line under the game day and the time
// of day it happened. The day planner reads it; the owner can ask for it
// ("what did you do today?"). Raw days are kept until the planner's day
// summary replaces them, so a long life never makes the planning request grow.

import { bot } from "../core/body";
import { getMemory, updateMemory } from "../managers/persistenceManager";

export type DiaryLine = { at: number; time: string; text: string; times?: number };
export type DiaryDay = { day: number; lines: DiaryLine[]; gains?: Record<string, number> };

// Raw days kept (older ones are dropped once summarised, or past this)
const RAW_DAYS = 3;
// Lines a day keeps (the oldest go first; a busy day stays readable)
const LINES_PER_DAY = 60;
// Day summaries kept for the planner's memory
const SUMMARIES = 10;

/** The part of the day a time (ticks, 0-23999) falls in. Pure. */
export function partOfDay(timeOfDay: number): string {
  const t = ((timeOfDay % 24000) + 24000) % 24000;
  if (t < 6000) return "morning";
  if (t < 12000) return "afternoon";
  if (t < 13800) return "evening";
  return "night";
}

/**
 * The day with `text` added: the same line again right after itself is
 * counted ("x3"), not repeated; past the day's limit the oldest lines go. Pure.
 */
export function withLine(day: DiaryDay, line: DiaryLine): DiaryDay {
  const last = day.lines.at(-1);
  if (last && last.text === line.text) {
    return { ...day, lines: [...day.lines.slice(0, -1), { ...last, times: (last.times ?? 1) + 1 }] };
  }
  return { ...day, lines: [...day.lines, line].slice(-LINES_PER_DAY) };
}

/** A day as text, a line per event, with what it gathered at the end. Pure. */
export function renderDay(day: DiaryDay): string {
  const lines = day.lines.map((l) => `${l.time}: ${l.text}${l.times && l.times > 1 ? ` (x${l.times})` : ""}`);
  const gains = Object.entries(day.gains ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, n]) => `${n} ${name.replace(/_/g, " ")}`);
  if (gains.length > 0) lines.push(`picked up today: ${gains.join(", ")}`);
  return lines.join("\n");
}

/** The game day it is now (the world's day count; it moves on when someone sleeps). */
export function gameDay(): number {
  return bot.time?.day ?? 0;
}

function days(): DiaryDay[] {
  return (getMemory().diary ?? []) as DiaryDay[];
}

async function saveDay(day: DiaryDay): Promise<void> {
  const others = days().filter((d) => d.day !== day.day);
  const kept = [...others, day].sort((a, b) => a.day - b.day).slice(-RAW_DAYS);
  await updateMemory({ diary: kept });
}

function dayEntry(n: number): DiaryDay {
  return days().find((d) => d.day === n) ?? { day: n, lines: [] };
}

/** Writes a line in today's diary ("Reached milestone: stone tools."). */
export async function note(text: string): Promise<void> {
  if (!bot.entity) return;
  const line: DiaryLine = { at: Date.now(), time: partOfDay(bot.time?.timeOfDay ?? 0), text: text.trim() };
  console.log(`Diary: ${line.time}: ${line.text}`);
  await saveDay(withLine(dayEntry(gameDay()), line));
}

/** Counts what it picked up today (one line at the end of the day, not one per pickup). */
export async function noteGain(name: string, count: number): Promise<void> {
  if (!bot.entity) return;
  const day = dayEntry(gameDay());
  const gains = { ...(day.gains ?? {}) };
  gains[name] = (gains[name] ?? 0) + count;
  await saveDay({ ...day, gains });
}

/** Today's diary as text ("" when nothing happened yet). */
export function today(): string {
  return renderDay(dayEntry(gameDay()));
}

/** The raw diary days it still has (oldest first), for the planner. */
export function rawDays(): DiaryDay[] {
  return days();
}

/** The last few day summaries, oldest first. */
export function summaries(): { day: number; text: string }[] {
  return getMemory().daySummaries ?? [];
}

/**
 * Keeps the planner's summary of a day and drops that day's raw lines: the
 * diary is compressed into memory, so requests stay the same size.
 */
export async function summarise(day: number, text: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  const kept = [...summaries().filter((s) => s.day !== day), { day, text: clean }].sort((a, b) => a.day - b.day).slice(-SUMMARIES);
  await updateMemory({ daySummaries: kept, diary: days().filter((d) => d.day !== day) });
}
