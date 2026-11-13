"use client";

import { useState, useTransition } from "react";

type Result = { ok: true } | { ok: false; error: string };
type Success<R> = Extract<R, { ok: true }>;

const DONE_MS = 1600;
export const UNREACHABLE = "The request did not reach the server. Check your connection and try again.";

/** Calls a server action; a request that never reached the server comes back as a failed result with `UNREACHABLE`. */
export async function callAction<R extends Result>(action: () => Promise<R>): Promise<R | { ok: false; error: string }> {
  try {
    return await action();
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** Runs a server action in a transition; `done` is briefly true after success, `error` holds a failure's reason until the next run.
    Actions revalidate their pages, so `pending` lasts until the fresh data renders or the page `onSuccess` navigates to opens. */
export function useAction() {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = <R extends Result>(action: () => Promise<R>, onSuccess?: (result: Success<R>) => void) =>
    start(async () => {
      setError(null);
      setDone(false);
      const result = await callAction(action);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSuccess?.(result as Success<R>);
      setDone(true);
      setTimeout(() => setDone(false), DONE_MS);
    });

  return { pending, done, error, failed: error !== null, run };
}
