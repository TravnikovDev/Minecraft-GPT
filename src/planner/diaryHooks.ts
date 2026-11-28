// Path: src/planner/diaryHooks.ts
// What goes in the diary (Phase 7): the outcome of the work it did, the
// owner's words, deaths, milestones and what it picked up. Each becomes one
// short line from a template (planner/diary). Hooks are registered once and
// work across reconnects (the arbiter and event bus outlive a connection).

import { bot, listen } from "../core/body";
import { Bucket, onTaskEnd } from "../core/arbiter";
import { on } from "../core/events";
import { catalog } from "../core/catalog";
import { note, noteGain, resetDayCount, tickDayCount } from "./diary";

let registered = false;

/** Task names as words ("gatherWood" -> "gather wood"). */
const words = (name: string): string => name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/** The line a finished task leaves in the diary, or null for nothing worth a line. Pure. */
export function taskLine(task: { name: string; bucket: number }, outcome: "done" | "failed" | "cancelled", reason: string): string | null {
  // Idle chores, reflexes and threats make no line of their own
  if (task.bucket === Bucket.Idle || task.bucket < Bucket.Owner) return null;
  const what = words(task.name);
  const owners = task.bucket === Bucket.Owner;
  if (outcome === "done") {
    if (task.name.startsWith("night")) return "Spent the night in my shelter.";
    // A milestone's success is written when it's reached (curriculum), its
    // failure there too; a plan step's by the plan runner
    if (task.name.startsWith("milestone: ") || task.name.startsWith("plan: ")) return null;
    return owners ? `Did what the owner asked: ${what}.` : `Done: ${what}.`;
  }
  if (task.name.startsWith("plan: ")) return null;
  if (outcome === "failed") return `Couldn't finish ${what}${owners ? " (the owner's order)" : ""}.`;
  // Cancelled: only the telling reasons
  if (reason === "stuck" || reason === "took too long") return `Gave up on ${what}: ${reason}.`;
  if (/stop/i.test(reason) && owners) return `The owner stopped me: ${what}.`;
  return null;
}

/** Starts writing the diary (the clock per connection; the rest once per process). */
export function registerDiary(): void {
  resetDayCount();
  listen(bot, "time", () => void tickDayCount());
  if (registered) return;
  registered = true;

  onTaskEnd((task, outcome) => {
    const line = taskLine(task, outcome, String(task.signal.reason ?? ""));
    if (line) void note(line);
  });

  on("bot:died", ({ position }) => {
    const where = position ? ` at ${Math.floor(position.x)}, ${Math.floor(position.y)}, ${Math.floor(position.z)}` : "";
    // What was near when it died: the likely killer
    const near = bot.entity
      ? Object.values(bot.entities)
          .filter((e) => e !== bot.entity && e.name && catalog().isHostile(e.name) && e.position.distanceTo(bot.entity.position) < 10)
          .map((e) => words(e.name!).replace(/_/g, " "))
      : [];
    void note(`Died${where}${near.length ? ` (${[...new Set(near)].join(", ")} near)` : ""}.`);
  });

  on("item:collected", ({ name, count, from }) => {
    noteGain(name, count);
    if (from) void note(`${from} gave me ${count} ${name.replace(/_/g, " ")}.`);
  });
}

/** The owner's words, as a diary line (cut short). */
export function noteOwnerSaid(text: string): void {
  const t = text.trim();
  if (!t) return;
  void note(`The owner said: "${t.length > 80 ? `${t.slice(0, 77)}...` : t}"`);
}

/** A milestone reached. */
export function noteMilestone(title: string): void {
  void note(`Reached a milestone: ${title}.`);
}

/** A milestone it couldn't get, why, and where it stood (its weekly lessons are written from the diary). */
export function noteMilestoneFailed(title: string, why: string): void {
  const p = bot.entity?.position;
  const where = p ? ` (at ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})` : "";
  void note(`Couldn't get ${title}: ${why}${where}.`);
}
