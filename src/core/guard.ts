// Path: src/core/guard.ts
// Runs one game call so that it can never hang the bot: it ends with a result
// when the call finishes, when the command or chore it belongs to is stopped,
// when a time limit passes, or when the connection drops. On the last three it
// also undoes what the call left running (a walk, a dig, an open window).

import { bot } from "./body";
import { currentSignal } from "./commandContext";
import { classifyError, fail, ok, type ActionResult } from "./result";

export type GuardOptions = {
  /** Gives up after this long. */
  timeoutMs: number;
  /** Stops whatever the call left running (stop walking, stop digging, close the window). */
  onStop?: () => void;
  /** The signal to honour; by default the running command's or chore's. */
  signal?: AbortSignal;
};

/**
 * Runs `call` and turns how it ended into a result. A call already cancelled
 * before it starts doesn't run at all.
 */
export async function guarded<T>(label: string, call: () => Promise<T>, options: GuardOptions): Promise<ActionResult<T>> {
  const signal = options.signal ?? currentSignal();
  if (signal?.aborted) return fail("aborted", `${label}: stopped before it started`);
  const current = bot;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let onEnd: (() => void) | undefined;
  const ended = new Promise<ActionResult<T>>((resolve) => {
    timer = setTimeout(() => resolve(fail("timeout", `${label} took longer than ${Math.round(options.timeoutMs / 1000)}s`)), options.timeoutMs);
    onAbort = () => resolve(fail("aborted", `${label}: stopped`));
    signal?.addEventListener("abort", onAbort, { once: true });
    onEnd = () => resolve(fail("disconnected", `${label}: the connection dropped`));
    current?.once?.("end", onEnd);
  });
  const run = call().then(
    (value) => ok(value) as ActionResult<T>,
    (error) => (signal?.aborted ? fail("aborted", `${label}: stopped`) : classifyError(error))
  );
  try {
    const result = await Promise.race([run, ended]);
    if (!result.ok && (result.reason === "timeout" || result.reason === "aborted" || result.reason === "disconnected")) {
      try {
        options.onStop?.();
      } catch (error) {
        console.error(`Stopping ${label} failed:`, error);
      }
      void run.catch(() => undefined); // the abandoned call may still settle later
    }
    return result;
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    if (onEnd) current?.removeListener?.("end", onEnd);
  }
}
