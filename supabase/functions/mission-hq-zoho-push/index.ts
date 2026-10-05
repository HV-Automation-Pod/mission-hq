// ===========================================================================
// Push attendance into Zoho People's muster roll.
//
// WHAT CHANGED FROM THE PREVIOUS VERSION. That one pushed "yesterday", and
// only yesterday. The confirmation DM keeps its Edit button for ever, so people
// answer prompts from last week, and the recovery sweep repaired cells days
// late. None of it ever reached Zoho, so the muster roll quietly disagreed with
// our own records and nobody could see why. This pushes whatever is OWED, from
// `zoho_push_queue`, which covers yesterday and the week-old correction with
// the same query.
//
// CHECK-OUT IS NOT OPTIONAL. The first version of this push sent check-in
// only. Zoho replied `{"response":"success"}` for all 237 records and the
// muster roll showed `A` (Absent) with Worked Days = 0, because Zoho derives
// hours from the pair. An API success on this endpoint does not mean the day
// counted: verify in Attendance -> Organization Reports -> Muster roll.
//
// empId IS REQUIRED. A record identified by email is rejected with a generic
// 400 (code 7200) naming no field, and it takes down every record batched with
// it. Established by probe on 2026-08-05: 50 mixed records failed, the same 50
// minus the one email row passed, and that row then failed alone in a batch of
// one. The queue excludes rows without an emp_id for exactly this reason.
// ===========================================================================
import { pg } from "../_shared/pg.ts";
import { owedRows, pushRows } from "../_shared/zoho-push.ts";
import { denyUnlessScheduler } from "../_shared/auth.ts";
import { alert } from "../_shared/slack.ts";

// The batch size, pacing and nominal hours now live in `_shared/zoho-push.ts`,
// so the immediate push and this run cannot disagree about them.

type Row = {
  email: string;
  day: string;
  status: string;
  emp_id: string;
  site: string | null;
  day_fraction: number;
};

Deno.serve(async (req) => {
  // Scheduled job, not a public endpoint. See _shared/auth.ts.
  const denied = await denyUnlessScheduler(req);
  if (denied) return denied;

  const fn = "mission-hq-zoho-push";
  let body: { limit?: number; dryRun?: boolean } = {};
  try { body = await req.json(); } catch { /* cron sends {} */ }

  const dryRun = body.dryRun === true;

  try {
    const owed = await pg(
      `zoho_push_queue?select=email,day,status,emp_id,site,day_fraction` +
      `&order=day&limit=${Math.min(body.limit ?? 500, 2000)}`,
    ) as Row[];

    if (owed.length === 0) {
      return Response.json({ ok: true, owed: 0, pushed: 0 });
    }

    // Anybody who can never be pushed, so their employee id gets fixed rather
    // than them being absent in the muster roll for ever.
    const blocked = await pg("zoho_push_blocked?select=email,full_name,days_unpushable") as
      Array<{ email: string; full_name: string; days_unpushable: number }>;

    if (dryRun) {
      return Response.json({ ok: true, dryRun: true, owed: owed.length, blocked: blocked.length, sample: owed.slice(0, 3) });
    }

    // The batching, the nominal hours, the errors-inside-a-200 check and the
    // stamp-only-after-acceptance rule all live in `_shared/zoho-push.ts`, so
    // this run and the immediate push from the Slack submit handler cannot
    // drift apart on any of them.
    const { pushed, failures } = await pushRows(owed);

    if (failures.length) {
      await alert("Attendance push to Zoho failed for some batches",
        failures.map((f) => `• ${f}`).join("\n") +
        `\n\nThose rows are still owed and the next run will retry them. ` +
        `The muster roll is behind until it succeeds.`, fn);
    }

    if (blocked.length) {
      await alert("Attendance cannot be pushed for some people",
        blocked.map((b) => `• ${b.full_name || b.email} (${b.days_unpushable} day(s))`).join("\n") +
        `\n\nThey have no Zoho employee id in \`mission-hq.employees\`, and a record ` +
        `identified by email is rejected by Zoho in a way that fails the whole batch. ` +
        `They will be absent in the muster roll until the id is filled.`, fn);
    }

    return Response.json({ ok: true, owed: owed.length, pushed, failedBatches: failures.length, blocked: blocked.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await alert("Attendance push to Zoho failed outright",
      `Nothing reached the muster roll. ${message}`, fn);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
