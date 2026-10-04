/**
 * Who is allowed to invoke a scheduled job.
 *
 * These functions were reachable by anyone on the internet. Not "anyone with
 * the anon key" — anyone at all: a POST with no `Authorization` header, and one
 * with a deliberately invalid bearer, both reached the handler and got its own
 * 400 back rather than a 401. They had been deployed with `--no-verify-jwt`,
 * which is correct for the Slack webhook (Slack does not send Supabase JWTs,
 * and authenticity there is the signature check) and wrong for everything else.
 *
 * `verify_jwt = true` alone would not be enough either. It checks "is this a
 * JWT this project signed", and the anon key is one — it ships to every
 * browser. It proves the caller has read a public value, not who they are.
 *
 * THE SHARED SECRET LIVES IN `settings`, NOT IN AN ENV VAR, for two reasons.
 * The project is at its secret cap, so there is no room for a new one. And the
 * obvious shortcut — compare against `SUPABASE_SERVICE_ROLE_KEY`, which the
 * platform injects — does not actually work: the value the platform injects is
 * not byte-identical to the one in the local `.env`, so a legitimate scheduler
 * call was rejected 403 by exactly the gate meant to admit it. `settings` is
 * service-role only (migration 06), so nothing that cannot already read the
 * whole database can read this.
 *
 * It also means the service-role key never travels in a header.
 *
 * WHAT WAS REACHABLE, and why this is a write problem rather than a read one:
 *
 *   mission-hq-access     an official "you now have admin access" DM to any
 *                         employee, carrying a caller-chosen button URL. A
 *                         phishing message from the company's own bot.
 *   mission-hq-prompt     DM anybody and write a real attendance row
 *   mission-hq-summary    re-post a fortnightly report to the real channels
 *                         and advance the snapshot number
 *   mission-hq-zoho-push  write check-in pairs into the Zoho muster roll
 *   mission-hq-directory  replace the Slack account snapshot wholesale
 */
import { pg } from "./pg.ts";

/** Constant-time compare. The timing of a `!==` on a secret is a side channel. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Returns a Response when the caller is not the scheduler, or null when they
 * are. Call it as the FIRST thing in the handler:
 *
 *     const denied = await denyUnlessScheduler(request);
 *     if (denied) return denied;
 */
export async function denyUnlessScheduler(request: Request): Promise<Response | null> {
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.replace(/^Bearer\s+/i, "").trim();

  // Read it before the early return, so a missing header and a wrong one cost
  // the same. Cheap here: one PostgREST round trip on a job that runs daily.
  let expected: string | undefined;
  try {
    const rows = await pg("settings?select=value&key=eq.edge_invoke_key") as Array<{ value: string }>;
    expected = rows?.[0]?.value;
  } catch {
    expected = undefined;
  }

  if (!expected) {
    // Fail CLOSED. An unreadable secret is a misconfiguration, and the version
    // of this that returns null here is an open endpoint awaiting one bad day.
    return new Response(JSON.stringify({ ok: false, error: "not configured" }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }

  if (!bearer || !timingSafeEqual(bearer, expected)) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
      status: 403, headers: { "content-type": "application/json" },
    });
  }
  return null;
}
