// Path: src/managers/chatGateway.ts
// Single entry point for chat: only the configured owner is obeyed, and the
// most common commands (stop, come, follow, status) are handled by code with
// no LLM call, so they work instantly and even when OpenAI is unreachable.

import { bot } from "../core/body";
import { OWNER_USERNAME } from "../config/env";
import { BotCommands } from "../commands/types";
import { initiateActionFromAI } from "./aiManager";
import {
  cancelCurrentCommand,
  getCurrentCommandName,
  stopEverything,
} from "./actionManager";
import { executeTool } from "./toolManager";
import { addCommandToQueue, getAllCommands } from "./persistenceManager";
import { answerPending, hasPendingQuestion, rememberOwnerPosition } from "./ownerDialog";
import { recordTurn } from "../core/session";

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

/** Builds a short status line from the bot's real state. */
async function statusMessage(): Promise<string> {
  const current = getCurrentCommandName();
  const queued = (await getAllCommands()).filter((c) => c.command !== current).length;
  const pos = bot.entity?.position;
  const where = pos ? `at ${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}` : "somewhere";
  const doing = current ? `Doing ${current}` : "Idle";
  const next = queued > 0 ? `, ${queued} more queued` : "";
  const owner = bot.players[OWNER_USERNAME]?.entity;
  const ownerInfo = owner && pos
    ? ` You're ${Math.round(owner.position.distanceTo(pos))} blocks away.`
    : " I can't see you from here.";

  console.log(
    `[status] pos=${pos?.toString()} owner=${owner ? owner.position.toString() : "not visible"} ` +
      `pathfinderMoving=${bot.pathfinder?.isMoving()}`
  );

  return `${doing}${next}. Health ${Math.round(bot.health)}/20, food ${bot.food}/20, ${where}.${ownerInfo}`;
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
    await cancelCurrentCommand("owner gave coordinates");
    await addCommandToQueue({
      id: crypto.randomUUID(),
      command: BotCommands.GoToCoordinates,
      priority: 1,
      retryCount: 0,
      args: { x, y, z },
    });
    bot.chat(`On my way to ${x}, ${y}, ${z}!`);
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
    // The owner calling outranks whatever the bot is doing right now
    await cancelCurrentCommand(follow ? "owner asked to follow" : "owner called");
    await addCommandToQueue({
      id: crypto.randomUUID(),
      command: follow ? BotCommands.FollowPlayer : BotCommands.GoToPlayer,
      priority: 1,
      retryCount: 0,
      args: follow
        ? { player_name: OWNER_USERNAME, distance: 3 }
        : { player_name: OWNER_USERNAME, closeness: 2 },
    });
    bot.chat(follow ? "Following you!" : "Coming!");
    return true;
  }

  if (STATUS.test(message)) {
    console.log("Fast path: status");
    bot.chat(await statusMessage());
    return true;
  }

  return false;
}

/**
 * Handles a chat line or whisper. Messages from anyone but the owner are
 * ignored; the owner's simple commands use the fast path, everything else
 * goes to the LLM router.
 */
export async function handleChat(username: string, message: string): Promise<void> {
  if (username === bot.username) return;
  if (!isOwner(username)) {
    console.log(`Ignoring chat from ${username} (only ${OWNER_USERNAME} can command the bot)`);
    return;
  }

  const text = stripBotName(message);
  recordTurn("owner", text);
  try {
    if (await tryFastPath(text)) return;
    await initiateActionFromAI(username, text);
  } catch (error) {
    console.error("Error handling owner chat:", error);
  }
}
