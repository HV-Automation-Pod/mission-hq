// ===========================================================================
// TEMPORARY. Delete this folder when the backfill is done.
//
//     supabase functions delete mission-hq-zoho-backfill --project-ref <REF>
//     rm -rf supabase/functions/mission-hq-zoho-backfill
//
// It is NOT on a cron schedule and nothing calls it. There is no migration to
// undo: it reads through PostgREST and reuses `_shared/zoho-push.ts`, so the
// batching, nominal hours, half-day rule and the stamp-after-acceptance rule
// are the same ones the real jobs use.
//
// WHY IT EXISTS AND WHY IT IS NOT THE NORMAL QUEUE. `zoho_push_queue` offers a
// row only while `zoho_pushed_at` is null or older than `updated_at`. That is
// correct for running a system and useless for repairing one: if our stamp
// says we sent a day and Zoho does not have it, the queue will never offer it
// again. This ignores the stamp and re-sends regardless.
//
// ONE DAY PER CALL, on purpose. Zoho's Bulk Import allows 10 requests per
// 5-minute lock. A day of ~350 people is ~7 requests at 50 per batch, so one
// day fits inside one lock window and two days do not. The caller waits out
// the window between days; `nextDay` in the response is where to resume.
//
// It reports `blocked` separately rather than failing: a record identified by
// anything other than a Zoho employee id fails the ENTIRE batch it travels in,
// so those people are excluded here exactly as the live queue excludes them.
// ===========================================================================
import { pg } from "../_shared/pg.ts";
import { denyUnlessScheduler } from "../_shared/auth.ts";
import { pushRows, type PushRow } from "../_shared/zoho-push.ts";

type Loc = { status: string; w_wfo: number; w_wfh: number; w_wfa: number };
type Emp = { email: string; emp_id: string | null; location: string | null; location_override: string | null };
type Att = { email: string; day: string; status: string };

const nextDate = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

Deno.serve(async (request) => {
  const denied = await denyUnlessScheduler(request);
  if (denied) return denied;

  let body: { day?: string; to?: string } = {};
  try { body = await request.json(); } catch { /* no body */ }

  const day = body.day;
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Response.json({ ok: false, error: "pass {\"day\":\"YYYY-MM-DD\"}" }, { status: 400 });
  }

  try {
    // Presence statuses and their day fraction, from the same weights the
    // reports use, so a status that is half a day there is half a day here.
    const locs = await pg("locations?select=status,w_wfo,w_wfh,w_wfa") as Loc[];
    const fraction = new Map<string, number>();
    for (const l of locs) {
      const f = Number(l.w_wfo) + Number(l.w_wfh) + Number(l.w_wfa);
      if (f > 0) fraction.set(l.status, f);
    }
    const presence = [...fraction.keys()];

    const rows = await pg(
      `attendance?select=email,day,status&day=eq.${day}` +
      `&status=in.(${presence.map(encodeURIComponent).join(",")})&limit=2000`,
    ) as Att[];

    if (rows.length === 0) {
      return Response.json({ ok: true, day, found: 0, pushed: 0, nextDay: nextDate(day) });
    }

    const emps = await pg(
      "employees?select=email,emp_id,location,location_override&limit=2000",
    ) as Emp[];
    const byEmail = new Map(emps.map((e) => [e.email, e]));

    const push: PushRow[] = [];
    const blocked: string[] = [];
    for (const r of rows) {
      const e = byEmail.get(r.email);
      if (!e?.emp_id) { blocked.push(r.email); continue; }
      push.push({
        email: r.email,
        day: r.day,
        status: r.status,
        emp_id: e.emp_id,
        // `site(e)` in SQL: the override if somebody set one, else Zoho's.
        site: (e.location_override || "").trim() || e.location,
        day_fraction: fraction.get(r.status) ?? 1,
      });
    }

    const result = await pushRows(push);
    return Response.json({
      ok: result.failures.length === 0,
      day,
      found: rows.length,
      pushed: result.pushed,
      blocked: blocked.length,
      failures: result.failures,
      nextDay: nextDate(day),
      note: "Zoho allows 10 Bulk Import requests per 5-minute lock. Wait ~5 minutes before the next day.",
    }, { status: result.failures.length ? 500 : 200 });
  } catch (error) {
    return Response.json(
      { ok: false, day, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
