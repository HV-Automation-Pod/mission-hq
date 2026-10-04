// ===========================================================================
// Push attendance into Zoho People's muster roll.
//
// WHAT CHANGED FROM THE APPS SCRIPT VERSION. That one pushed "yesterday", and
// only yesterday. The confirmation DM keeps its Edit button for ever, so people
// answer prompts from last week, and the recovery sweep repaired cells days
// late. None of it ever reached Zoho, so the muster roll quietly disagreed with
// the sheet and nobody could see why. This pushes whatever is OWED, from
// `zoho_push_queue`, which covers yesterday and the week-old correction with
// the same query.
//
// CHECK-OUT IS NOT OPTIONAL. The first version of the Apps Script sent check-in
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
import { denyUnlessScheduler } from "../_shared/auth.ts";
import { alert } from "../_shared/slack.ts";
import { zohoAccessToken, zohoDomain } from "../_shared/zoho.ts";

// Bulk Import allows 10 requests per 5-minute lock. Fifty per batch means a
// full org day is ~5 requests. Do not drop below 25: ten requests at that size
// already sits on the ceiling.
const BATCH = 50;
const PAUSE_MS = 2_000;

// Nominal hours, not real ones. Phase one records presence; hours worked is a
// later problem.
const IN_TIME = "09:30:00";
const OUT_FULL = "18:30:00";
const OUT_HALF = "13:30:00";

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

    const token = await zohoAccessToken();
    const domain = zohoDomain();

    let pushed = 0;
    const failures: string[] = [];

    for (let i = 0; i < owed.length; i += BATCH) {
      const slice = owed.slice(i, i + BATCH);

      const records = slice.map((r) => {
        const record: Record<string, string> = {
          empId: r.emp_id,
          checkIn: `${r.day} ${IN_TIME}`,
          // Half a worked day finishes at lunch. Anything else is a full day.
          checkOut: `${r.day} ${Number(r.day_fraction) < 1 ? OUT_HALF : OUT_FULL}`,
        };
        // Optional in Zoho, and omitted rather than sent blank.
        if (r.site) record.location = r.site;
        return record;
      });

      // The payload goes in the BODY, not the query string.
      //
      // Fifty records encode to about 8.3 KB of URL, against the 8 KB default
      // that nginx and Apache both ship with. It sat just over the line, which
      // is the worst place to sit: not a clean failure, an intermittent one.
      // And the failure mode had no exit — a 414 is not retryable, so the
      // batch would fail, stay unpushed, and be rebuilt identically the next
      // evening, for ever.
      //
      // A body also keeps a day of attendance out of every access log between
      // here and Zoho, for the same reason the token refresh moved.
      const body = new URLSearchParams({
        data: JSON.stringify(records),
        dateFormat: "yyyy-MM-dd HH:mm:ss",
      });

      try {
        const response = await fetch(`${domain}/people/api/attendance/bulkImport`, {
          method: "POST",
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body,
        });
        const text = await response.text();

        // A 200 is not enough: this endpoint returns errors inside a 200 body.
        let ok = response.ok;
        if (ok && /"errors"|"status"\s*:\s*1|code"\s*:\s*7200/i.test(text)) ok = false;
        if (!ok) throw new Error(`HTTP ${response.status} ${text.slice(0, 200)}`);

        // Stamped only after Zoho accepts. A failure leaves the rows owed, so
        // the next run retries them rather than marking them silently sent.
        await pg("rpc/mark_zoho_pushed", {
          method: "POST",
          body: JSON.stringify({
            p_rows: slice.map((r) => ({ email: r.email, day: r.day })),
          }),
        });
        pushed += slice.length;
      } catch (error) {
        failures.push(
          `${slice[0].day}..${slice[slice.length - 1].day} (${slice.length} records): ` +
          (error instanceof Error ? error.message : String(error)),
        );
      }

      if (i + BATCH < owed.length) await new Promise((r) => setTimeout(r, PAUSE_MS));
    }

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
