"use server";

import { revalidatePath } from "next/cache";
import { attempt, invokeToken, requireEditor, type ActionResult } from "./shared";

/** Running the scheduled jobs by hand. Editors only. */

/**
 * Run one of the scheduled jobs now.
 *
 * Allowlisted by NAME rather than taking a URL: this calls an authenticated
 * internal endpoint, and letting the caller choose which one is how a
 * convenience button becomes a request forwarder.
 */
const JOBS = {
  directory: "mission-hq-directory",
  leave: "mission-hq-leave",
  prompt: "mission-hq-prompt",
  verify: "mission-hq-verify",
  remind: "mission-hq-remind",
  "zoho-push": "mission-hq-zoho-push",
  summary: "mission-hq-summary",
} as const;

export async function runJob(job: keyof typeof JOBS, body: Record<string, unknown> = {}): Promise<ActionResult> {
  return attempt(async () => {
    await requireEditor();
    const fn = JOBS[job];
    if (!fn) throw new Error(`Unknown job: ${job}`);

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!base) throw new Error("Supabase is not configured");

    const response = await fetch(`${base}/functions/v1/${fn}`, {
      method: "POST",
      headers: { authorization: `Bearer ${await invokeToken()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    revalidatePath("/admin");
    // Deliberately NOT named `ok`. `attempt()` owns that field and it answers
    // "did the action run"; this answers "what did the job say", and the two
    // are different questions — a job that runs and returns 500 is a
    // successful action reporting a failed job.
    return { status: response.status, body: text.slice(0, 2000) };
  });
}
