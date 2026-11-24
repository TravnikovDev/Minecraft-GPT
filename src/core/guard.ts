// Path: src/core/guard.ts
// Runs one game call so that it can never hang the bot: it ends with a result
// when the call finishes, when the command or chore it belongs to is stopped,
// when a time limit (or a watchdog) gives up, or when the connection drops.
// The call gets its own abort signal that fires on all of these, so work it
// started (a walk waiting out a reflex) ends too instead of running on in the
// background; `onStop` undoes what the game is still doing (a walk, a dig, an
// open window).

import { bot } from "./body";
import { currentSignal } from "./commandContext";
import { classifyError, fail, ok, type ActionResult, type FailReason } from "./result";

export type GuardOptions = {
  /** Gives up after this long. */
  timeoutMs: number;
  /** Stops whatever the call left running (stop walking, stop digging, close the window). */
  onStop?: () => void;
  /** The signal to honour; by default the running command's or chore's. */
  signal?: AbortSignal;
  /** Another way to give up (e.g. no progress for a while); its abort reason is the detail. */
  watchdog?: AbortSignal;
};

/**
 * Runs `call` and turns how it ended into a result. A call already cancelled
 * before it starts doesn't run at all. `call` receives a signal that aborts
 * whenever the guard gives up, for work it hands on (a walk, a wait).
 */
export async function guarded<T>(
  label: string,
  call: (signal: AbortSignal) => Promise<T>,
  options: GuardOptions
): Promise<ActionResult<T>> {
  const outer = options.signal ?? currentSignal();
  if (outer?.aborted) return fail("aborted", `${label}: stopped before it started`);
  const current = bot;
  const inner = new AbortController();
  let settle: (result: ActionResult<T>) => void = () => {};
  const ended = new Promise<ActionResult<T>>((resolve) => (settle = resolve));
  const giveUp = (reason: FailReason, detail: string): void => {
    if (inner.signal.aborted) return;
    inner.abort(detail);
    settle(fail(reason, detail));
  };

  const timer = setTimeout(() => giveUp("timeout", `${label} took longer than ${Math.round(options.timeoutMs / 1000)}s`), options.timeoutMs);
  const onAbort = (): void => giveUp("aborted", `${label}: stopped`);
  const onWatchdog = (): void => giveUp("timeout", `${label}: ${String(options.watchdog?.reason ?? "no progress")}`);
  const onEnd = (): void => giveUp("disconnected", `${label}: the connection dropped`);
  outer?.addEventListener("abort", onAbort, { once: true });
  options.watchdog?.addEventListener("abort", onWatchdog, { once: true });
  current?.once?.("end", onEnd);

  // A call that throws straight away still goes through the same path
  const run = Promise.resolve()
    .then(() => call(inner.signal))
    .then(
      (value) => ok(value) as ActionResult<T>,
      (error) => (outer?.aborted ? fail("aborted", `${label}: stopped`) : classifyError(error))
    );
  try {
    const result = await Promise.race([run, ended]);
    if (!result.ok && (result.reason === "timeout" || result.reason === "aborted" || result.reason === "disconnected")) {
      inner.abort(result.detail);
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
    outer?.removeEventListener("abort", onAbort);
    options.watchdog?.removeEventListener("abort", onWatchdog);
    current?.removeListener?.("end", onEnd);
  }
}
