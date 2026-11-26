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

/**
 * The bot's own day count, kept in world memory. The world clock can't be
 * trusted for this: /time set moves it, and in the Nether and the End it
 * stands still. A day begins when the time of day wraps round to the
 * morning (the night passed, or it slept). Starts from the world's count.
 */
export function gameDay(): number {
  return getMemory().dayCount?.day ?? bot.time?.day ?? 0;
}

/**
 * The day count after the clock moved from `before` to `now` (times of day,
 * 0-23999): a new day when it came round to the morning from the evening or
 * night. Pure.
 */
export function nextDayCount(day: number, before: number | null, now: number): number {
  if (before === null) return day;
  return before >= 12000 && now < 12000 && now < before ? day + 1 : day;
}

let lastTimeOfDay: number | null = null;

/** Watches the clock (called on mineflayer's "time" event, about once a second). */
export async function tickDayCount(): Promise<void> {
  if (!bot.time) return;
  const now = bot.time.timeOfDay;
  const before = lastTimeOfDay;
  lastTimeOfDay = now;
  const current = gameDay();
  const next = nextDayCount(current, before, now);
  if (getMemory().dayCount === undefined || next !== current) await updateMemory({ dayCount: { day: next } });
}

/** A new connection: the clock is read afresh (no day counted for the time it was away). */
export function resetDayCount(): void {
  lastTimeOfDay = null;
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

// Pickups counted in memory and written with the next line or within a
// minute (a save per pickup parsed the whole memory on every block mined)
const pendingGains = new Map<string, number>();
const GAINS_FLUSH_MS = 60_000;
let gainsTimer: ReturnType<typeof setTimeout> | null = null;

/** The day with the pickups counted since the last save added. */
function withGains(day: DiaryDay): DiaryDay {
  if (pendingGains.size === 0) return day;
  const gains = { ...(day.gains ?? {}) };
  for (const [name, n] of pendingGains) gains[name] = (gains[name] ?? 0) + n;
  pendingGains.clear();
  return { ...day, gains };
}

/** Writes a line in today's diary ("Reached milestone: stone tools."). */
export async function note(text: string): Promise<void> {
  if (!bot.entity) return;
  const line: DiaryLine = { at: Date.now(), time: partOfDay(bot.time?.timeOfDay ?? 0), text: text.trim() };
  console.log(`Diary: ${line.time}: ${line.text}`);
  await saveDay(withLine(withGains(dayEntry(gameDay())), line));
}

/** Counts what it picked up today (one line at the end of the day, not one per pickup). */
export function noteGain(name: string, count: number): void {
  pendingGains.set(name, (pendingGains.get(name) ?? 0) + count);
  gainsTimer ??= setTimeout(() => {
    gainsTimer = null;
    if (pendingGains.size > 0 && bot.entity) void saveDay(withGains(dayEntry(gameDay())));
  }, GAINS_FLUSH_MS);
}

/** Today's diary as text ("" when nothing happened yet). */
export function today(): string {
  return renderDay(withGainsPreview(dayEntry(gameDay())));
}

/** The day with the not-yet-saved pickups shown (without clearing them). */
function withGainsPreview(day: DiaryDay): DiaryDay {
  if (pendingGains.size === 0) return day;
  const gains = { ...(day.gains ?? {}) };
  for (const [name, n] of pendingGains) gains[name] = (gains[name] ?? 0) + n;
  return { ...day, gains };
}

/** The lines of a day written after `since` (what the planner hasn't summarised yet). */
export function linesSince(day: DiaryDay, since: number): DiaryDay {
  return { ...day, lines: day.lines.filter((l) => l.at > since) };
}

/** The raw diary days it still has (oldest first), for the planner. */
export function rawDays(): DiaryDay[] {
  return days();
}

/** The last few day summaries, oldest first (`at`: when it was written). */
export function summaries(): { day: number; text: string; at?: number }[] {
  return getMemory().daySummaries ?? [];
}

/**
 * Keeps the planner's summary of a day. The raw lines stay (the owner reads
 * them; a poor summary must not replace the real record): only the planning
 * request leaves out what a summary already covers, so it stays small.
 */
export async function summarise(day: number, text: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  const kept = [...summaries().filter((s) => s.day !== day), { day, text: clean, at: Date.now() }].sort((a, b) => a.day - b.day).slice(-SUMMARIES);
  await updateMemory({ daySummaries: kept });
}
