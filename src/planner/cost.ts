// Path: src/planner/cost.ts
// What the model calls cost (Phase 7): every call's tokens are priced and
// added to this month's total, kept in usage.json (all worlds together; it
// is the owner's money, not a world's). Past the monthly cap in .env
// (LLM_MONTHLY_CAP_USD, default $10) no more calls are made: the bot lives by
// its own milestone plan and handles the owner's chat in code only.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { LLM_MONTHLY_CAP_USD } from "../config/env";

// List prices per million tokens (input, output). gpt-6-luna: the researched
// price, see reports/Minecraft AI bot architecture.md "Cost"
const PRICES: Record<string, { input: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, output: 0.5 },
};
// An unknown model is priced high, so the cap errs on the safe side
const UNKNOWN_PRICE = { input: 2, output: 8 };

export type Purpose = "chat" | "plan" | "lessons";
export type MonthUsage = { month: string; calls: number; inputTokens: number; outputTokens: number; usd: number; byPurpose: Record<string, number> };

// USAGE_PATH: the tests' throwaway file (tests/setup.ts)
const FILE = process.env["USAGE_PATH"] ?? `${import.meta.dir}/../../usage.json`;

/** The month a time falls in ("2026-11"). Pure. */
export const monthOf = (at: number): string => new Date(at).toISOString().slice(0, 7);

/** What a call cost in dollars. Pure. */
export function priceOf(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? UNKNOWN_PRICE;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** This month's usage with one more call added (a new month starts from zero). Pure. */
export function withCall(usage: MonthUsage | null, at: number, purpose: Purpose, model: string, inputTokens: number, outputTokens: number): MonthUsage {
  const month = monthOf(at);
  const base: MonthUsage = usage && usage.month === month ? usage : { month, calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, byPurpose: {} };
  const usd = priceOf(model, inputTokens, outputTokens);
  return {
    month,
    calls: base.calls + 1,
    inputTokens: base.inputTokens + inputTokens,
    outputTokens: base.outputTokens + outputTokens,
    usd: base.usd + usd,
    byPurpose: { ...base.byPurpose, [purpose]: (base.byPurpose[purpose] ?? 0) + usd },
  };
}

function load(): MonthUsage | null {
  try {
    if (!existsSync(FILE)) return null;
    const data = JSON.parse(readFileSync(FILE, "utf8")) as MonthUsage;
    return data.month === monthOf(Date.now()) ? data : null;
  } catch (error) {
    console.error("Couldn't read usage.json; counting this month from zero:", error);
    return null;
  }
}

/** Records one model call's tokens (input and output). */
export function recordCall(purpose: Purpose, model: string, inputTokens: number, outputTokens: number): void {
  const next = withCall(load(), Date.now(), purpose, model, inputTokens, outputTokens);
  try {
    writeFileSync(FILE, JSON.stringify(next, null, 2));
  } catch (error) {
    console.error("Couldn't save usage.json:", error);
  }
  console.log(`LLM ${purpose}: ${inputTokens} in, ${outputTokens} out, $${priceOf(model, inputTokens, outputTokens).toFixed(5)}; this month $${next.usd.toFixed(4)} of $${LLM_MONTHLY_CAP_USD}.`);
}

/** This month's usage (zero when nothing was spent yet). */
export function thisMonth(): MonthUsage {
  return load() ?? { month: monthOf(Date.now()), calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, byPurpose: {} };
}

/** True when this month's spending reached the cap: no more model calls. */
export function overBudget(): boolean {
  return thisMonth().usd >= LLM_MONTHLY_CAP_USD;
}

// Its own planning (day plans and lessons) may use this share of the cap, a
// day's worth at a time; the rest is always there for the owner's chat. A
// bot left running day and night, or a day when everything fails, then never
// spends the month's money in its first week and goes quiet on the owner
export const PLAN_SHARE = 0.8;

/**
 * What its own planning may have spent by now this month: its share of the
 * cap, in proportion to the days gone (today included), so days it spent
 * little carry over. Pure.
 */
export function planningAllowance(cap: number, at: number): number {
  const d = new Date(at);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return cap * PLAN_SHARE * (d.getUTCDate() / daysInMonth);
}

/** What day plans and lessons have cost this month. Pure. */
export const planningSpent = (usage: MonthUsage): number => (usage.byPurpose["plan"] ?? 0) + (usage.byPurpose["lessons"] ?? 0);

/** True when its own planning has used up its share so far this month: no more plans of its own till tomorrow. */
export function planningPaced(now = Date.now()): boolean {
  return planningSpent(thisMonth()) >= planningAllowance(LLM_MONTHLY_CAP_USD, now);
}

/** The cap, for chat ("$0.42 of $10 this month"). */
export const monthlyCap = (): number => LLM_MONTHLY_CAP_USD;
