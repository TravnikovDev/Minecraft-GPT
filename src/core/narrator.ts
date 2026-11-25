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
import { AsyncLocalStorage } from "node:async_hooks";
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
  /** A line from code that still calls bot.chat directly: capped while waiting. */
  legacy?: boolean;
  /** Not kept for an offline owner (a yes/no question that expires). */
  noHold?: boolean;
};

type Channel = "whisper" | "chat";
type Line = {
  text: string;
  kind: Kind;
  to: Audience;
  topic?: string;
  task?: AbortSignal;
  at: number;
  full?: string;
  /** The way the owner asked, taken when it was said (a reply goes back that way). */
  channel: Channel;
  /** The rest of a long message: nothing drops it or jumps ahead of it. */
  cont?: boolean;
  legacy?: boolean;
  noHold?: boolean;
};

/** Sends one paced line; set per connection by the Body. Returns false when it can't (offline owner). */
export type Sender = { chat(text: string): void; whisper(to: string, text: string): void; ownerName(): string | null };

const SPACING_MS = 1200; // about one line a second: confirmed safe in the owner's game
const REPEAT_WINDOW_MS = 30_000;
const MAX_CHATTER_WAITING = 4;
const MAX_LEGACY_WAITING = 6;
const MAX_HELD = 20;
const DIGEST_LINES = 5;
const CHAT_LIMIT = 256; // characters per chat packet, the "/tell name " included

const queue: Line[] = [];
const held: Line[] = []; // replies and reports for an owner who is offline
const recent = new Map<string, number>();
let sender: Sender | null = null;
let spacingMs = SPACING_MS;
let timer: ReturnType<typeof setTimeout> | null = null;
let ownerChannel: Channel = "whisper";
// The channel of the owner message being handled (set by the chat gateway)
const channelContext = new AsyncLocalStorage<Channel>();
const sentHooks: Array<(text: string, to: string | null) => void> = [];

/** The Body sets how lines are actually sent (per connection), or null while disconnected. */
export function setSender(next: Sender | null, spacing = SPACING_MS): void {
  sender = next;
  spacingMs = spacing;
  if (sender) pump();
}

/** The channel the owner last used, so a reply goes back the same way. */
export function setOwnerChannel(channel: Channel): void {
  ownerChannel = channel;
}

/** Runs the handling of one owner message: replies said within it go back the same way. */
export function withOwnerChannel<T>(channel: Channel, fn: () => T): T {
  ownerChannel = channel;
  return channelContext.run(channel, fn);
}

/** Runs for every line actually sent (logging). */
export function onLineSent(hook: (text: string, to: string | null) => void): void {
  sentHooks.push(hook);
}

/** Says something. Default: a report, whispered to the owner. */
export function say(text: string, options: SayOptions = {}): void {
  // One line per message: a newline would make mineflayer send unpaced extra packets
  const clean = text.replace(/\s*\n\s*/g, " ").trim();
  if (!clean) return;
  const kind = options.kind ?? "report";
  const task = currentSignal();
  // Work that was stopped says nothing more (no late "failed" after "stop")
  if (kind !== "reply" && task?.aborted) return;
  const line: Line = {
    text: clean,
    kind,
    to: options.to ?? "owner",
    topic: options.topic,
    task,
    at: Date.now(),
    channel: channelContext.getStore() ?? ownerChannel,
    legacy: options.legacy,
    noHold: options.noHold,
  };

  // The same words to the same people a moment ago: once is enough (replies always go)
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > REPEAT_WINDOW_MS) recent.delete(k);
  const key = `${line.to}:${clean}`;
  if (kind !== "reply" && recent.has(key)) return;
  recent.set(key, now);

  const free = (l: Line): boolean => !l.cont; // a continuation is never dropped
  if (kind === "chatter") {
    // Newer news on the same topic replaces the old; too much chatter: drop the oldest
    if (line.topic) {
      const old = queue.findIndex((l) => free(l) && l.kind === "chatter" && l.topic === line.topic);
      if (old >= 0) queue.splice(old, 1);
    }
    const chatter = queue.filter((l) => free(l) && l.kind === "chatter");
    if (chatter.length >= MAX_CHATTER_WAITING) queue.splice(queue.indexOf(chatter[0]!), 1);
    queue.push(line);
  } else {
    if (line.legacy) {
      // Old code that talks in loops: only the latest few wait
      const legacy = queue.filter((l) => free(l) && l.legacy);
      if (legacy.length >= MAX_LEGACY_WAITING) queue.splice(queue.indexOf(legacy[0]!), 1);
    }
    // Replies go ahead of everything not yet sent, reports ahead of chatter,
    // but never between the parts of a long message being sent
    const goesBefore = (l: Line): boolean => free(l) && (kind === "reply" ? l.kind !== "reply" : l.kind === "chatter");
    const at = queue.findIndex(goesBefore);
    queue.splice(at < 0 ? queue.length : at, 0, line);
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
    const l = queue[i]!;
    if (!l.cont && l.task === task && (l.kind === "chatter" || (options.reports && l.kind === "report"))) queue.splice(i, 1);
  }
}

/** The owner said stop: drop all chatter waiting, and reports from cancelled work. */
export function dropForStop(): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    const l = queue[i]!;
    if (!l.cont && (l.kind === "chatter" || (l.kind === "report" && (l.task?.aborted || l.legacy)))) queue.splice(i, 1);
  }
}

/** The owner joined: a short digest of what they missed comes first. */
export function ownerJoined(): void {
  if (held.length === 0) return;
  const lines = held.splice(0);
  // Every answer, and the latest few reports
  const reports = lines.filter((l) => l.kind !== "reply");
  const shownReports = reports.slice(-DIGEST_LINES);
  const shown = lines.filter((l) => l.kind === "reply" || shownReports.includes(l));
  const skipped = lines.length - shown.length;
  const digest = (text: string): Line => ({ text, kind: "reply", to: "owner", at: Date.now(), channel: "whisper" });
  queue.unshift(digest(`While you were away${skipped > 0 ? ` (and ${skipped} more)` : ""}:`), ...shown.map((l) => ({ ...digest(l.text) })));
  if (!timer) pump();
}

/** Splits a long message at word boundaries into lines that fit a chat packet. */
export function splitLine(text: string, max = CHAT_LIMIT - 1): string[] {
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
    if (line.kind !== "chatter" && !line.noHold) {
      held.push(line);
      if (held.length > MAX_HELD) held.shift();
    }
    console.log(`[to owner, offline] ${line.text}`);
    pump();
    return;
  }
  const whisperTo = line.to === "owner" && !(line.kind === "reply" && line.channel === "chat") ? owner : null;
  // Room for "/tell <name> " when whispering
  const parts = splitLine(line.text, CHAT_LIMIT - 1 - (whisperTo ? `/tell ${whisperTo} `.length : 0));
  try {
    if (whisperTo) sender.whisper(whisperTo, parts[0]!);
    else sender.chat(parts[0]!);
    for (const hook of sentHooks) hook(parts[0]!, whisperTo);
    chatSent(parts[0]!, whisperTo);
  } catch (error) {
    console.error("Failed to send chat:", error);
  }
  // The rest of a long message goes next, paced like any line
  if (parts.length > 1) queue.unshift({ ...line, text: parts.slice(1).join(" "), full: line.full ?? line.text, cont: true });
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
  // Sending starts once the bot is in the world: before that the player list
  // is empty and every line would look like it's for an owner who's offline
  currentBot.once("spawn", () => setSender(mine));
  // Code that still calls bot.chat directly: public reports, capped while waiting
  currentBot.chat = (message: string): void => say(message, { kind: "report", to: "all", legacy: true });
  currentBot.whisper = (username: string, message: string): void => {
    if (isOwnerName(username)) say(message, { kind: "report", to: "owner", legacy: true });
    else console.log(`Not whispering to ${username}: the bot only talks to its owner privately.`);
  };
  // The owner joins: what they missed first
  currentBot.on("playerJoined", (player: { username: string }) => {
    if (isOwnerName(player.username)) setTimeout(ownerJoined, 2_000);
  });
  currentBot.once("end", () => {
    if (sender === mine) setSender(null);
  });
});
