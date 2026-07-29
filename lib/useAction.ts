"use client";

import { useCallback, useState, useTransition } from "react";
import type { ActionResult } from "./actions";

/**
 * Call a server action from a client component.
 *
 * Wraps the call in a transition so `pending` stays true until the server has
 * re-rendered — the actions call revalidatePath, so the button should not go
 * idle before the new numbers are on screen.
 *
 * Errors arrive as values (see lib/actions.ts) rather than thrown, so this keeps
 * the last one and the field it belongs to, for rendering next to the control
 * that caused it. Nothing here retries or swallows: a failed save leaves the
 * control showing what the server said and the PM's input intact.
 *
 * `runWith` takes an `optimistic` callback applied *inside* the transition, just
 * before the call goes out. That placement is the whole point. A `useOptimistic`
 * update made outside a transition is not tied to anything that finishes, so React
 * warns and never reverts it — a refused save would leave the wrong value sitting
 * on screen looking saved. Running it here binds the optimistic value to this
 * transition, so it holds until the server answers and then gives way to the truth.
 */
/**
 * What a control shows when the session ended underneath it (R23, AE10).
 *
 * Handled here rather than in each control so every save in the app gets it from
 * one place. The bare `NotAuthenticated` message ("Sign in to continue.") reads
 * as a permission complaint mid-scoring, when what actually happened is that the
 * save was refused and the work is still on screen unsaved.
 *
 * It says "didn't save" and stops there because the way back is a link rather
 * than a sentence — `components/ControlError.tsx` renders it beside this, and
 * claiming anything about what was or was not saved beyond this one refusal
 * would be guessing.
 */
export const SESSION_ENDED_MESSAGE = "Your session ended, so that didn't save.";

export function useAction<A extends unknown[], T>(fn: (...args: A) => Promise<ActionResult<T>>) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | undefined>(undefined);
  const [reauth, setReauth] = useState(false);

  const runWith = useCallback(
    (optimistic: (() => void) | undefined, ...args: A) =>
      new Promise<ActionResult<T>>((resolve, reject) => {
        setError(null);
        setField(undefined);
        setReauth(false);
        startTransition(async () => {
          optimistic?.();
          try {
            const result = await fn(...args);
            if (!result.ok) {
              setError(result.reauth ? SESSION_ENDED_MESSAGE : result.error);
              setField(result.field);
              setReauth(result.reauth === true);
            }
            resolve(result);
          } catch (e) {
            // A thrown error is a programmer error or an infrastructure failure —
            // toResult deliberately rethrows those. Surface it rather than
            // rendering it as if the PM had typed something wrong.
            setError(e instanceof Error ? e.message : "Something went wrong.");
            reject(e);
          }
        });
      }),
    [fn],
  );

  const run = useCallback((...args: A) => runWith(undefined, ...args), [runWith]);

  return {
    run,
    runWith,
    pending,
    error,
    field,
    /** True when the failure was an ended session rather than a refused input. */
    reauth,
    clearError: () => setError(null),
  };
}
