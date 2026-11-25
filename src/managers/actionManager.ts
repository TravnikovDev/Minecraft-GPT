// Path: src/managers/actionManager.ts
// Owner commands as arbiter tasks (core/arbiter). A command is proposed in
// the owner bucket; the owner calling the bot ("come here", "follow me",
// coordinates) cuts in on what's running, and what was cut off carries on
// afterwards with what's left of it (gathering 10 wood after 4: 6 more).
// No queue in the database and no polling loop: the arbiter runs tasks as
// they come.

import { CommandSchema } from "../schemas/mainSchemas";
import type { CommandType } from "../schemas/types";
import { BotCommands } from "../commands/types";
import { executeTool } from "./toolManager";
import { Bucket, cancelRunning, currentTask, onTaskEnd, propose, resetArbiter, stopAll, type TaskSpec } from "../core/arbiter";
import { currentSignal, getCurrentCommandName, isCommandCancelled, progressOf } from "../core/commandContext";
import { stopReflexes } from "../core/reflexes";
import { resetChores, stopChores } from "../core/chores";
import { resetLeases } from "../core/leases";
import { bot } from "../core/body";
import { dropForStop, dropFromTask } from "../core/narrator";

// A task's commentary still waiting when it ends is old news
onTaskEnd((task) => dropFromTask(task.signal));

// Re-exported for managers that already import them from here
export { getCurrentCommandName, isCommandCancelled };

// How long the owner's "stop" keeps fighting, creeper dodging and chores quiet
const STOP_MUTES_REFLEXES_MS = 60_000;

// A backstop on how long one command may run (each also has its own checks;
// the stuck watcher catches one that stops making progress)
const DEFAULT_LIMIT_MS = 5 * 60_000;
const LONG_RUNNING_LIMITS: Partial<Record<BotCommands, number>> = {
  [BotCommands.GoToCoordinates]: 30 * 60_000,
  [BotCommands.GoToPlayer]: 30 * 60_000,
  [BotCommands.GoToNamedLocation]: 30 * 60_000,
  [BotCommands.ReturnToBase]: 30 * 60_000,
  [BotCommands.GatherWood]: 15 * 60_000,
  [BotCommands.CollectBlocks]: 15 * 60_000,
  [BotCommands.Hunting]: 10 * 60_000,
  [BotCommands.GoByBoat]: 30 * 60_000,
  [BotCommands.Harvest]: 10 * 60_000,
  [BotCommands.GatherFood]: 15 * 60_000,
  [BotCommands.Cook]: 15 * 60_000,
};

// Walking somewhere: cut off, it just walks there again from where it is
const GO_AGAIN = new Set<string>([
  BotCommands.GoToCoordinates,
  BotCommands.GoToNamedLocation,
  BotCommands.ReturnToBase,
  BotCommands.GoToBlock,
  BotCommands.DigToSurface,
  BotCommands.FollowPlayer,
]);
// Counted work: cut off, it does what's left (the count it reported done is
// taken off); with no count given, it starts over from where it is
const COUNTED: Partial<Record<string, string>> = {
  [BotCommands.CollectBlocks]: "num",
  [BotCommands.GatherWood]: "num",
  [BotCommands.Hunting]: "count",
};
// Going somewhere: a newer one replaces an older one (no going back to the old trip)
const MOVES = new Set<string>([
  BotCommands.GoToCoordinates,
  BotCommands.GoToNamedLocation,
  BotCommands.ReturnToBase,
  BotCommands.GoToBlock,
  BotCommands.GoToPlayer,
  BotCommands.FollowPlayer,
  BotCommands.GoByBoat,
  BotCommands.DigToSurface,
]);
// Following lasts until something else needs the bot: the next command goes
// first and following carries on after it; standing still with the owner isn't "stuck"
const FOLLOW = BotCommands.FollowPlayer as string;

const pretty = (name: string): string => name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/** How a cut-off command carries on later (rebuilt from where things stand then), or null to drop it. */
function resumeFor(command: CommandType, signal: () => AbortSignal | undefined): ((cutInBy: { name: string } | null) => TaskSpec | null) | undefined {
  // A newer trip (or "come here") replaces this one
  const replacedBy = (cutInBy: { name: string } | null): boolean => MOVES.has(command.command) && cutInBy !== null && MOVES.has(cutInBy.name);
  if (GO_AGAIN.has(command.command)) return (cutInBy) => (replacedBy(cutInBy) ? null : commandTask(command, true));
  const countArg = COUNTED[command.command];
  if (countArg) {
    return () => {
      const raw = (command.args as Record<string, unknown> | undefined)?.[countArg];
      if (raw === null || raw === undefined) return commandTask(command, true); // "all of them": look again
      const s = signal();
      const left = Number(raw) - (s ? progressOf(s) : 0);
      if (left <= 0) return null;
      return commandTask({ ...command, args: { ...(command.args as object), [countArg]: left } }, true);
    };
  }
  return undefined; // one-off (give, craft, store...): not redone half-way
}

// The same command with the same arguments isn't queued twice
const waiting = new Set<string>();
const keyOf = (command: CommandType): string => `${command.command}:${JSON.stringify(command.args ?? {})}`;

/** The arbiter task for an owner command. */
function commandTask(command: CommandType, resumed = false): TaskSpec {
  let signal: AbortSignal | undefined;
  const key = keyOf(command);
  const follow = command.command === FOLLOW;
  return {
    name: command.command,
    bucket: Bucket.Owner,
    // The owner calling the bot outranks what it's doing (priority 1); a
    // resumed task never cuts in again (it would cut off what cut it off)
    interrupts: !resumed && (command.priority ?? 3) <= 1 && command.priority !== 0,
    yields: follow,
    watchProgress: !follow,
    maxMs: follow ? undefined : LONG_RUNNING_LIMITS[command.command as BotCommands] ?? DEFAULT_LIMIT_MS,
    resume: resumeFor(command, () => signal),
    onStart: (wasResumed) => {
      waiting.delete(key);
      if (wasResumed || resumed) bot.chat(`Back to ${pretty(command.command)}.`);
    },
    run: async () => {
      signal = currentSignal();
      await executeTool(command.command, command.args);
    },
    onEnd: (outcome) => {
      // A command that threw gets its retries (a cancelled one never does)
      if (outcome === "failed" && (command.retryCount ?? 0) > 0) {
        console.log(`Retrying ${command.command} (${command.retryCount} left).`);
        queueCommand({ ...command, id: crypto.randomUUID(), retryCount: (command.retryCount ?? 1) - 1 });
      }
    },
  };
}

/**
 * Queues an owner command (or a step the bot gives itself, like recovering
 * its things). `priority` 0 runs before other waiting commands, 1 cuts in on
 * what's running (the owner calling the bot), 3 waits its turn. The same
 * command with the same arguments already waiting or running is skipped.
 */
export function queueCommand(input: CommandType): void {
  const parsed = CommandSchema.safeParse({ ...input, retryCount: input.retryCount ?? 0 });
  if (!parsed.success) {
    console.error("Command validation failed:", parsed.error);
    return;
  }
  const command = parsed.data as CommandType;
  const key = keyOf(command);
  // The same command still waiting: once is enough (running it again later is fine)
  if (waiting.has(key)) {
    console.log(`Command ${command.command} is already waiting. Skipping.`);
    if ((command.priority ?? 3) > 0) bot.chat("That's already on my list.");
    return;
  }
  waiting.add(key);
  console.log(`Queueing ${command.command} (priority ${command.priority}) with args: ${JSON.stringify(command.args ?? {})}`);
  propose(commandTask(command), { front: command.priority === 0 });
}

/** Cancels the running command (if any), without resuming it later. */
export async function cancelCurrentCommand(reason: string): Promise<void> {
  if (currentTask()?.bucket === Bucket.Owner) await cancelRunning(reason, false);
}

/**
 * The owner's "stop": ends the running task and everything waiting, the
 * stoppable reflexes (fighting, creeper dodging) and the idle chores, and
 * keeps those quiet for a minute (running out of air is never muted).
 */
export async function stopEverything(): Promise<void> {
  waiting.clear();
  dropForStop(); // no late "failed" or commentary after "stop"
  stopReflexes(STOP_MUTES_REFLEXES_MS);
  await stopChores("Stopped by player", STOP_MUTES_REFLEXES_MS);
  await stopAll("Stopped by player");
}

/**
 * The connection dropped: end the running task now, not at the next spawn.
 * Otherwise a task that's waiting or looping runs on through the reconnect
 * delay and then drives the new connection.
 */
export function abortForDisconnect(): void {
  void stopAll("disconnected");
}

/** A new connection: nothing runs, nothing waits, nobody holds the body. */
export function handleBotRejoin(): void {
  console.log("Bot rejoined the server. Starting with a clean slate.");
  waiting.clear();
  resetArbiter();
  resetChores();
  resetLeases();
}
