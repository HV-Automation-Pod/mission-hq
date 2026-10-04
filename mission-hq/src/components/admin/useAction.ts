"use client";

import { useState, useTransition } from "react";

export type ActionState = { pending: boolean; error: string | null; done: string | null };

/**
 * Run a server action and keep what happened on screen.
 *
 * Every mutation here changes something about a real person — whether they get
 * prompted, which site they are reported under, who can see 350 people's
 * attendance. A control that silently does nothing when it fails is worse than
 * one that is not there, so the failure is shown where the button is, and the
 * success is shown long enough to be read.
 */
export function useAction() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>, message = "Saved", after?: () => void) => {
    setError(null);
    setDone(null);
    startTransition(async () => {
      try {
        // Server actions RETURN their failures rather than throwing them: a
        // thrown one is replaced by a generic string before it reaches the
        // browser, so the message never arrives. See `attempt()` in actions.ts.
        const result = await fn() as { ok?: boolean; error?: string } | undefined;
        if (result && result.ok === false) {
          setError(result.error || "Something went wrong");
          return;
        }
        setDone(message);
        after?.();
        setTimeout(() => setDone(null), 2500);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  };

  return { run, pending: isPending, error, done, clear: () => { setError(null); setDone(null); } };
}
