// Path: src/managers/chatGateway.ts
// Single entry point for chat: only the configured owner is obeyed, and the
// most common commands (stop, come, follow, status) are handled by code with
// no LLM call, so they work instantly and even when OpenAI is unreachable.

import { bot } from "../core/body";
import { OWNER_USERNAME } from "../config/env";
import { BotCommands } from "../commands/types";
import { initiateActionFromAI } from "./aiManager";
import { getCurrentCommandName, queueCommand, stopEverything } from "./actionManager";
import { executeTool } from "./toolManager";
import { Bucket, currentTask, pendingTasks } from "../core/arbiter";
import { holderOf, isTakenUrgently } from "../core/leases";
import { ago, owner, sky, threats, vitals } from "../actions/perception";
import { answerPending, hasPendingQuestion, ownerDistance, rememberOwnerPosition } from "./ownerDialog";
import { recordTurn } from "../core/session";
import { setOwnerChannel } from "../core/narrator";
import { reply } from "../core/narrator";

// Owner commands handled without the LLM. Each pattern matches the whole
// message (allowing "please", the bot's name and trailing punctuation).
const PREFIX = String.raw`^(?:(?:hey|ok|okay|please)[,\s]+)*`;
const SUFFIX = String.raw`[\s,]*(?:please)?[\s!.?]*$`;
const STOP = new RegExp(`${PREFIX}(?:stop|halt|freeze|stand still)(?:\\s+(?:it|now|everything))?${SUFFIX}`, "i");
const COME = new RegExp(`${PREFIX}(?:come(?:\\s+(?:here|to me|back))?)${SUFFIX}`, "i");
const FOLLOW = new RegExp(`${PREFIX}(?:follow me)${SUFFIX}`, "i");
const STATUS = new RegExp(`${PREFIX}(?:status|what are you doing|what're you doing|whats up|what's up)${SUFFIX}`, "i");
const WHERE = new RegExp(`${PREFIX}(?:where are you|where r u|how far are you|how far away are you|your location|location)${SUFFIX}`, "i");
const YES = new RegExp(`${PREFIX}(?:yes|yeah|yep|yup|sure|ok|okay|go|go ahead|do it|please do)${SUFFIX}`, "i");
const NO = new RegExp(`${PREFIX}(?:no|nope|nah|don't|do not|cancel|never mind|nevermind)${SUFFIX}`, "i");
// "come to 505 67 -1085", "go to x=505 y=67 z=-1085", "I'm at 505, 67, -1085" or just "505 67 -1085"
const COORDS = /^(?:(?:please\s+)?(?:come|go|walk|travel)\s+(?:to\s+)?|i'?m\s+at\s+|i\s+am\s+at\s+)?\s*x?\s*[:=]?\s*(-?\d+)[\s,]+y?\s*[:=]?\s*(-?\d+)[\s,]+z?\s*[:=]?\s*(-?\d+)\s*[!.]*$/i;

/** True if this username is the configured owner (usernames are case-insensitive). */
export function isOwner(username: string): boolean {
  return username.toLowerCase() === OWNER_USERNAME.toLowerCase();
}

/** Strips a leading "BotName," / "@BotName" so "MinecraftGPT, stop" works too. */
function stripBotName(message: string): string {
  const name = bot.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return message.replace(new RegExp(`^@?${name}[,:\\s]+`, "i"), "").trim();
}

// What a reflex holding the body is doing, for "status"
const PAUSED_BY: Record<string, string> = {
  drowning: "swimming up for air",
  creeper: "dealing with a creeper",
  combat: "fighting",
  eating: "eating",
  unstuck: "getting unstuck",
};
const pretty = (name: string): string => name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/**
 * "status" / "what are you doing?" from real state: the arbiter (the task,
 * what paused it, what's next) and perception (health, food, the sky,
 * threats, where the owner is). Exported for tests.
 */
export function statusMessage(): string {
  const task = currentTask();
  const waitingTasks = pendingTasks().filter((t) => t.bucket <= Bucket.Self);
  const holder = holderOf("movement");
  const pausedBy = holder && isTakenUrgently("movement") && holder.bucket <= 1 ? PAUSED_BY[holder.name] ?? holder.name : null;

  const doing = !task
    ? pausedBy
      ? pretty(pausedBy).replace(/^./, (c) => c.toUpperCase())
      : "Idle"
    : task.name === BotCommands.FollowPlayer
      ? "Following you"
      : `${pretty(task.name).replace(/^./, (c) => c.toUpperCase())}${pausedBy ? ` (paused: ${pausedBy})` : ""}`;
  const next = waitingTasks.length > 0 ? `; next: ${pretty(waitingTasks[0]!.name)}${waitingTasks.length > 1 ? ` (+${waitingTasks.length - 1} more)` : ""}` : "";

  const parts: string[] = [`${doing}${next}.`];
  const v = vitals();
  if (v.known) parts.push(`Health ${v.value.health}/20, food ${v.value.food}/20.`);
  const s = sky();
  if (s.known) parts.push(`${s.value.phase[0]!.toUpperCase()}${s.value.phase.slice(1)}${s.value.thundering ? ", thunderstorm" : s.value.raining ? ", raining" : ""}.`);
  const t = threats();
  if (t.known && t.value.length > 0) {
    const nearest = t.value.reduce((a, b) => (b.distance < a.distance ? b : a));
    parts.push(`${t.value.length} hostile${t.value.length === 1 ? "" : "s"} near (${nearest.name} ${Math.round(nearest.distance)} blocks).`);
  }
  const o = owner();
  if (o.known) {
    const st = o.value;
    if (st.state === "visible") parts.push(`You're ${Math.round(st.distance)} blocks away.`);
    else if (st.state === "out of range") parts.push(st.lastKnown ? `I can't see you; you were last near ${Math.round(st.lastKnown.x)}, ${Math.round(st.lastKnown.z)} ${ago(st.lastKnown.at)}.` : "I can't see you from here.");
  }
  const pos = bot.entity?.position;
  if (pos) parts.push(`I'm at ${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}.`);
  return parts.join(" ");
}

/** Handles the owner's simple commands. Returns true if the message was handled. */
async function tryFastPath(message: string): Promise<boolean> {
  // Answers to a question the bot asked ("Should I go get the wool?")
  if (hasPendingQuestion()) {
    if (YES.test(message)) return answerPending(true);
    if (NO.test(message)) return answerPending(false);
  }

  const coords = COORDS.exec(message);
  if (coords) {
    const [x, y, z] = coords.slice(1, 4).map(Number) as [number, number, number];
    console.log(`Fast path: go to ${x} ${y} ${z}`);
    rememberOwnerPosition(x, y, z, true); // the owner almost always sends their own position
    // Cuts in on what it's doing (priority 1); that carries on afterwards
    queueCommand({
      id: crypto.randomUUID(),
      command: BotCommands.GoToCoordinates,
      priority: 1,
      retryCount: 0,
      args: { x, y, z },
    });
    reply(`On my way to ${x}, ${y}, ${z}!`);
    return true;
  }

  if (WHERE.test(message)) {
    console.log("Fast path: where");
    await executeTool(BotCommands.TellLocation, {});
    return true;
  }

  if (STOP.test(message)) {
    console.log("Fast path: stop");
    await stopEverything();
    await executeTool(BotCommands.Stop, {});
    return true;
  }

  if (COME.test(message) || FOLLOW.test(message)) {
    const follow = FOLLOW.test(message);
    console.log(`Fast path: ${follow ? "follow" : "come"}`);
    // Already on the way: saying it again doesn't restart the walk
    const already = follow ? BotCommands.FollowPlayer : BotCommands.GoToPlayer;
    if (getCurrentCommandName() === already) {
      const dist = ownerDistance();
      reply(follow ? "I\'m following you!" : `On my way${dist === null ? "" : `, ${Math.round(dist)} blocks to go`}!`);
      return true;
    }
    // The owner calling outranks whatever the bot is doing right now (it carries on afterwards)
    queueCommand({
      id: crypto.randomUUID(),
      command: follow ? BotCommands.FollowPlayer : BotCommands.GoToPlayer,
      priority: 1,
      retryCount: 0,
      args: follow
        ? { player_name: OWNER_USERNAME, distance: 3 }
        : { player_name: OWNER_USERNAME, closeness: 2 },
    });
    reply(follow ? "Following you!" : "Coming!");
    return true;
  }

  if (STATUS.test(message)) {
    console.log("Fast path: status");
    reply(statusMessage());
    return true;
  }

  return false;
}

/**
 * Handles a chat line or whisper. Messages from anyone but the owner are
 * ignored; the owner's simple commands use the fast path, everything else
 * goes to the LLM router.
 */
export async function handleChat(username: string, message: string, channel: "chat" | "whisper" = "chat"): Promise<void> {
  if (username === bot.username) return;
  if (!isOwner(username)) {
    console.log(`Ignoring chat from ${username} (only ${OWNER_USERNAME} can command the bot)`);
    return;
  }

  const text = stripBotName(message);
  console.log(`Owner says${channel === "whisper" ? " (whisper)" : ""}: ${text}`);
  setOwnerChannel(channel); // replies go back the way the owner asked
  recordTurn("owner", text);
  try {
    if (await tryFastPath(text)) return;
    await initiateActionFromAI(username, text);
  } catch (error) {
    console.error("Error handling owner chat:", error);
  }
}
