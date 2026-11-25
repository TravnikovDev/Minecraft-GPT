// Path: src/core/narrator.ts
// The Narrator: the one outbox for everything the bot says (Phase 5). It
// lives for the whole process (a reconnect doesn't lose an answer) and paces
// every line, because servers kick players who chat too fast.
//
// Every message has a kind:
// - reply: an answer to the owner. Never dropped, sent first, kept while the
//   owner is offline. It goes back on the channel the owner used (whisper or
//   public chat).
// - report: the outcome of a task ("Collected 10 coal ore"). Never dropped,
//   de-duplicated, kept while the owner is offline.
// - chatter: running commentary ("Fighting a zombie"). Needs a topic: a newer
//   line on the same topic replaces one still waiting, there's a cap, and a
//   task's chatter is thrown away when the task ends.
//
// While the owner is offline, replies and reports wait (at most 20); when
// they join, a short digest comes first. Display names come from the Catalog.

import { OWNER_USERNAME } from "../config/env";
import { chatSent, onLogin } from "./body";
import { currentSignal } from "./commandContext";
import { recordTurn } from "./session";

export type Kind = "reply" | "report" | "chatter";
export type Audience = "owner" | "all";
export type SayOptions = {
  kind?: Kind;
  /** "owner": whispered to the owner (public chat for a reply asked publicly); "all": public chat. */
  to?: Audience;
  /** For chatter: a newer line on the same topic replaces one still waiting. */
  topic?: string;
};

type Line = { text: string; kind: Kind; to: Audience; topic?: string; task?: AbortSignal; at: number; full?: string };

/** Sends one paced line; set per connection by the Body. Returns false when it can't (offline owner). */
export type Sender = { chat(text: string): void; whisper(to: string, text: string): void; ownerName(): string | null };

const SPACING_MS = 1200; // about one line a second: confirmed safe in the owner's game
const REPEAT_WINDOW_MS = 30_000;
const MAX_CHATTER_WAITING = 4;
const MAX_HELD = 20;
const DIGEST_LINES = 5;
const MAX_LINE = 240; // chat packets are 256 characters; room for "/tell name "

const queue: Line[] = [];
const held: Line[] = []; // replies and reports for an owner who is offline
const recent = new Map<string, number>();
let sender: Sender | null = null;
let spacingMs = SPACING_MS;
let timer: ReturnType<typeof setTimeout> | null = null;
let ownerChannel: "whisper" | "chat" = "whisper";
const sentHooks: Array<(text: string, to: string | null) => void> = [];

/** The Body sets how lines are actually sent (per connection), or null while disconnected. */
export function setSender(next: Sender | null, spacing = SPACING_MS): void {
  sender = next;
  spacingMs = spacing;
  if (sender) pump();
}

/** The channel the owner last used, so a reply goes back the same way. */
export function setOwnerChannel(channel: "whisper" | "chat"): void {
  ownerChannel = channel;
}

/** Runs for every line actually sent (logging). */
export function onLineSent(hook: (text: string, to: string | null) => void): void {
  sentHooks.push(hook);
}

/** Says something. Default: a report, whispered to the owner. */
export function say(text: string, options: SayOptions = {}): void {
  const clean = text.trim();
  if (!clean) return;
  const kind = options.kind ?? "report";
  const line: Line = { text: clean, kind, to: options.to ?? "owner", topic: options.topic, task: currentSignal(), at: Date.now() };

  // The same words to the same people a moment ago: once is enough (replies always go)
  const key = `${line.to}:${clean}`;
  const last = recent.get(key);
  if (kind !== "reply" && last !== undefined && Date.now() - last < REPEAT_WINDOW_MS) return;
  recent.set(key, Date.now());

  if (kind === "chatter") {
    // Newer news on the same topic replaces the old; too much chatter: drop the oldest
    if (line.topic) {
      const old = queue.findIndex((l) => l.kind === "chatter" && l.topic === line.topic);
      if (old >= 0) queue.splice(old, 1);
    }
    const chatter = queue.filter((l) => l.kind === "chatter");
    if (chatter.length >= MAX_CHATTER_WAITING) queue.splice(queue.indexOf(chatter[0]), 1);
    queue.push(line);
  } else if (kind === "reply") {
    // Replies go ahead of everything not yet sent (in the order asked)
    const firstNonReply = queue.findIndex((l) => l.kind !== "reply");
    queue.splice(firstNonReply < 0 ? queue.length : firstNonReply, 0, line);
  } else {
    // Reports go ahead of chatter
    const firstChatter = queue.findIndex((l) => l.kind === "chatter");
    queue.splice(firstChatter < 0 ? queue.length : firstChatter, 0, line);
  }
  if (!timer) pump();
}

/** Shorthands. */
export const reply = (text: string, to: Audience = "owner"): void => say(text, { kind: "reply", to });
export const report = (text: string, to: Audience = "owner"): void => say(text, { kind: "report", to });
export const chatter = (text: string, topic: string, to: Audience = "owner"): void => say(text, { kind: "chatter", topic, to });

/**
 * A task ended: its chatter still waiting is dropped (and, when the owner
 * said stop, its reports too: no late "failed" after "stop").
 */
export function dropFromTask(task: AbortSignal, options: { reports?: boolean } = {}): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    const l = queue[i];
    if (l.task === task && (l.kind === "chatter" || (options.reports && l.kind === "report"))) queue.splice(i, 1);
  }
}

/** The owner said stop: drop all chatter waiting, and reports from cancelled work. */
export function dropForStop(): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    const l = queue[i];
    if (l.kind === "chatter" || (l.kind === "report" && l.task?.aborted)) queue.splice(i, 1);
  }
}

/** The owner joined: a short digest of what they missed comes first. */
export function ownerJoined(): void {
  if (held.length === 0) return;
  const lines = held.splice(0);
  const shown = lines.slice(-DIGEST_LINES);
  const skipped = lines.length - shown.length;
  queue.unshift(
    { text: `While you were away${skipped > 0 ? ` (and ${skipped} more)` : ""}:`, kind: "reply", to: "owner", at: Date.now() },
    ...shown.map((l) => ({ ...l, kind: "reply" as const }))
  );
  if (!timer) pump();
}

/** Splits a long message at word boundaries into lines that fit a chat packet. */
export function splitLine(text: string, max = MAX_LINE): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function pump(): void {
  timer = null;
  if (!sender) return; // disconnected: lines wait for the next connection
  const line = queue.shift();
  if (!line) return;
  const owner = sender.ownerName();
  // To the owner, who's offline: replies and reports wait for them; chatter is only logged
  if (line.to === "owner" && !owner) {
    if (line.kind !== "chatter") {
      held.push(line);
      if (held.length > MAX_HELD) held.shift();
    }
    console.log(`[to owner, offline] ${line.text}`);
    pump();
    return;
  }
  const whisperTo = line.to === "owner" && !(line.kind === "reply" && ownerChannel === "chat") ? owner : null;
  const parts = splitLine(line.text);
  try {
    if (whisperTo) sender.whisper(whisperTo, parts[0]!);
    else sender.chat(parts[0]!);
    for (const hook of sentHooks) hook(parts[0]!, whisperTo);
    chatSent(parts[0]!, whisperTo);
  } catch (error) {
    console.error("Failed to send chat:", error);
  }
  // The rest of a long message goes next, paced like any line
  if (parts.length > 1) queue.unshift({ ...line, text: parts.slice(1).join(" "), full: line.full ?? line.text });
  // What the bot told the owner is part of the conversation (not chatter)
  else if (line.kind !== "chatter") recordTurn("bot", line.full ?? line.text);
  // No spacing (tests): send everything now
  if (spacingMs === 0) pump();
  else timer = setTimeout(pump, spacingMs);
}

/** Lines waiting (tests and status). */
export function waiting(): { text: string; kind: Kind }[] {
  return queue.map((l) => ({ text: l.text, kind: l.kind }));
}

/** Forgets everything waiting (tests). */
export function resetNarrator(): void {
  queue.length = 0;
  held.length = 0;
  recent.clear();
  if (timer) clearTimeout(timer);
  timer = null;
}

// --- Installing on each connection -------------------------------------------

const isOwnerName = (name: string): boolean => name.toLowerCase() === OWNER_USERNAME.toLowerCase();

// Every bot.chat and bot.whisper goes through the Narrator: code that still
// calls them directly gets pacing and de-duplication too (as a public or
// owner report), while the raw senders are kept for the queue itself.
onLogin((currentBot) => {
  const rawChat = currentBot.chat.bind(currentBot);
  const rawWhisper = currentBot.whisper.bind(currentBot);
  const mine: Sender = {
    chat: rawChat,
    whisper: rawWhisper,
    ownerName: () => Object.keys(currentBot.players).find(isOwnerName) ?? null,
  };
  setSender(mine);
  currentBot.chat = (message: string): void => say(message, { kind: "report", to: "all" });
  currentBot.whisper = (username: string, message: string): void => {
    if (isOwnerName(username)) say(message, { kind: "report", to: "owner" });
    else rawWhisper(username, message); // only the owner is ever whispered to; kept for safety
  };
  // The owner joins: what they missed first
  currentBot.on("playerJoined", (player: { username: string }) => {
    if (isOwnerName(player.username)) setTimeout(ownerJoined, 2_000);
  });
  currentBot.once("end", () => {
    if (sender === mine) setSender(null);
  });
});
