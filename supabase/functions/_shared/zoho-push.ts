// ===========================================================================
// Sending attendance to Zoho People, used by two callers that must agree.
//
// The nightly job drains the whole queue at 19:30. The Slack submit handler
// pushes the single row somebody just answered, immediately, so Zoho is right
// within seconds instead of within a day.
//
// They share this file rather than each having their own copy, because the
// parts that are easy to get wrong are the parts that must not differ: the
// nominal check-in and check-out times, the half-day rule, the fact that this
// endpoint reports failure INSIDE a 200 body, and the rule that a row is only
// stamped as pushed once Zoho has actually accepted it.
//
// BOTH CALLERS SELECT FROM `zoho_push_queue`, never from `attendance`. The view
// already encodes who is eligible: not Pending, has a Zoho employee id, within
// 60 days, and either never pushed or edited since. Re-deriving that at a
// second call site is how the two would drift.
//
// Pushing early is safe to repeat. The queue re-offers any row whose
// `updated_at` moved past its `zoho_pushed_at`, so an edited answer is sent
// again, and a row the nightly job has already sent is simply not in the queue.
// ===========================================================================
import { pg } from "./pg.ts";
import { zohoAccessToken, zohoDomain } from "./zoho.ts";

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

export type PushRow = {
  email: string;
  day: string;
  status: string;
  emp_id: string;
  site: string | null;
  day_fraction: number;
};

export type PushResult = { owed: number; pushed: number; failures: string[] };

/** The rows Zoho has not been told about, optionally narrowed to one person-day. */
export async function owedRows(filter?: { email: string; day: string }): Promise<PushRow[]> {
  const scope = filter
    ? `&email=eq.${encodeURIComponent(filter.email)}&day=eq.${encodeURIComponent(filter.day)}`
    : "";
  return await pg(
    `zoho_push_queue?select=email,day,status,emp_id,site,day_fraction${scope}` +
    `&order=day.asc&limit=2000`,
  ) as PushRow[];
}

export async function pushRows(rows: PushRow[]): Promise<PushResult> {
  if (rows.length === 0) return { owed: 0, pushed: 0, failures: [] };

  const token = await zohoAccessToken();
  const domain = zohoDomain();

  let pushed = 0;
  const failures: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);

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

    // The payload goes in the body: fifty records exceed the 8 KB URL default,
    // and a 414 is not retryable.
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

      // Stamped only after Zoho accepts. A failure leaves the rows owed, so the
      // next run retries them rather than marking them silently sent.
      await pg("rpc/mark_zoho_pushed", {
        method: "POST",
        body: JSON.stringify({ p_rows: slice.map((r) => ({ email: r.email, day: r.day })) }),
      });
      pushed += slice.length;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }

    if (i + BATCH < rows.length) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  return { owed: rows.length, pushed, failures };
}
