// Path: src/core/result.ts
// What every checked action returns (Phase 3: verified actions). An action
// only reports success after it checked the world: the block is really gone,
// the item is really in hand, the bot really arrived. A failure carries one of
// a few typed reasons, so callers can react (walk closer, make a tool, give up)
// and chat can say what went wrong instead of "failed".

/** Why an action didn't happen. */
export type FailReason =
  | "aborted" // the owner said stop, or another command took over
  | "interrupted" // something else cut in (a reflex, a path reset, death): worth trying again
  | "timeout" // it took too long (the server never answered)
  | "disconnected" // the connection dropped mid-action
  | "unreachable" // no way to walk there (or it stopped short)
  | "out_of_reach" // too far to touch from where it stands
  | "unknown_block" // that part of the world isn't loaded, so it's unknown (not air)
  | "not_found" // nothing there to act on, or the item isn't carried
  | "no_tool" // nothing it carries can break or harvest it
  | "refused" // the server said no (a game rule: bedrock, sleeping by day...)
  | "reverted" // the server undid it: a dug block came back, a placed one didn't stay
  | "forbidden" // inside an area it must keep out of (the owner said, or the server protects it)
  | "occupied" // the spot is taken
  | "no_support" // nothing to place it against
  | "full" // no room in the inventory or the container
  | "missing_items" // not enough materials
  | "error"; // anything else (logged)

export type Ok<T> = { ok: true; value: T };
export type Failed = { ok: false; reason: FailReason; detail: string };
export type ActionResult<T = void> = Ok<T> | Failed;

export function ok(): Ok<void>;
export function ok<T>(value: T): Ok<T>;
export function ok<T>(value?: T): Ok<T | undefined> {
  return { ok: true, value };
}

export function fail(reason: FailReason, detail: string): Failed {
  return { ok: false, reason, detail };
}

/** True for reasons that mean "it was stopped", not "it couldn't". */
export function wasStopped(result: ActionResult<unknown>): boolean {
  return !result.ok && (result.reason === "aborted" || result.reason === "disconnected");
}

const SAY: Record<FailReason, string> = {
  aborted: "I stopped",
  interrupted: "something interrupted me",
  timeout: "it took too long, so I gave up",
  disconnected: "I lost the connection",
  unreachable: "I can't find a way there",
  out_of_reach: "it's out of my reach",
  unknown_block: "I can't see that part of the world yet",
  not_found: "there's nothing there",
  no_tool: "I don't have the right tool",
  refused: "the server didn't let me",
  reverted: "the server put it back (a protected area?)",
  forbidden: "that's a place I must keep out of",
  occupied: "something is in the way",
  no_support: "there's nothing to put it against",
  full: "there's no room",
  missing_items: "I don't have what I need",
  error: "something went wrong",
};

/** A short chat line for a failure: "I can't find a way there (no path)". */
export function describeFailure(result: Failed): string {
  return result.detail ? `${SAY[result.reason]} (${result.detail})` : SAY[result.reason];
}

/**
 * Sorts an error from mineflayer or a plugin into a reason. "aborted" is never
 * guessed from a message (the guard decides that from the stop signal):
 * a changed goal, a reset path or a dig cut off by death is "interrupted".
 * Pathfinder errors carry a name (lib/goto.js); others are read by message
 * (mineflayer 4.39).
 */
export function classifyError(error: unknown): Failed {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "NoPath" || name === "Timeout") return fail("unreachable", message);
  if (name === "GoalChanged" || name === "PathStopped") return fail("interrupted", message);
  const m = message.toLowerCase();
  if (m === "cancelled") return fail("interrupted", message);
  if (m.includes("digging aborted") || m.includes("goal was changed") || m.includes("path was stopped")) return fail("interrupted", message);
  if (m.includes("no path") || m.includes("took to long to decide path")) return fail("unreachable", message);
  if (m.includes("timeout") || m.includes("timed out") || m.includes("took longer")) return fail("timeout", message);
  if (m.includes("no block has been placed") || m.includes("block is still") || m.includes("server rejected") || m.includes("not allowed")) {
    return fail("refused", message);
  }
  if (m.includes("too far") || m.includes("out of reach")) return fail("out_of_reach", message);
  if (m.includes("missing") || m.includes("not enough")) return fail("missing_items", message);
  if (m.includes("destination full") || m.includes("inventory full") || m.includes("is full")) return fail("full", message);
  return fail("error", message);
}

/**
 * A failed action, thrown where a caller works with exceptions (a whole
 * chest visit, a crafting chain). Catch it and read `result` for the reason.
 */
export class ActionError extends Error {
  constructor(public readonly result: Failed) {
    super(describeFailure(result));
    this.name = "ActionError";
  }
}

/** The value of a successful result, or throws an ActionError. */
export function expectOk<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new ActionError(result);
  return result.value;
}

/** The chat line for any error: the reason of an ActionError, else its message. */
export function explain(error: unknown): string {
  if (error instanceof ActionError) return describeFailure(error.result);
  return error instanceof Error ? error.message : String(error);
}
