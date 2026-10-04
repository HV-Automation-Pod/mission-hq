// ===========================================================================
// Pull today's approved leave out of Zoho People, before the prompts go out.
//
// WHY IT RUNS FIRST. Without it, somebody on approved leave gets a DM, does not
// answer it, and lands as `Pending` — which the fortnightly report counts
// against them, where `Leave` would have been neutral. The Apps Script flow
// synced leave inside the prompt run for exactly this reason; here it is its
// own job so a Zoho outage delays nobody's prompt.
//
// IT RUNS BEFORE 09:00 AND AGAIN AFTER. Leave approved at 11am is still leave.
// The second pass is free, because `mark_leave` only ever converts a blank or
// `Pending` day: anybody who has already answered keeps their answer.
//
// Zoho's leave records carry NO employee email — see migration 22. Matching is
// emp_id first, normalised name second, and anything matching neither is
// alerted rather than dropped, because a leave that fails to apply is somebody
// being nagged on holiday and then scored for it.
// ===========================================================================
import { pg, istToday } from "../_shared/pg.ts";
import { denyUnlessScheduler } from "../_shared/auth.ts";
import { alert } from "../_shared/slack.ts";
import { zohoAccessToken, zohoDomain } from "../_shared/zoho.ts";

type LeaveRecord = {
  EmployeeId?: string;
  Employee?: string;
  From?: string;
  To?: string;
};

/**
 * Zoho returns this payload in at least five shapes depending on the endpoint's
 * mood, and the Apps Script version accumulated a handler for each. They are
 * carried over verbatim rather than trimmed to the one seen today: the cost of
 * a spare branch is nothing, and the cost of guessing wrong is that leave
 * silently stops being applied and people on holiday get scored as Pending.
 */
function unwrap(json: unknown): LeaveRecord[] {
  const j = json as Record<string, any>;
  if (!j || typeof j !== "object") return [];
  if (Array.isArray(j.data)) return j.data;
  if (j.records && typeof j.records === "object") return Object.values(j.records) as LeaveRecord[];
  const r = j.response?.result;
  if (Array.isArray(r)) return r;
  if (Array.isArray(r?.data)) return r.data;
  if (r && typeof r === "object") {
    const out: LeaveRecord[] = [];
    for (const v of Object.values(r)) {
      if (Array.isArray(v)) out.push(...(v as LeaveRecord[]));
      else if (v && typeof v === "object") out.push(v as LeaveRecord);
    }
    return out;
  }
  return [];
}

async function approvedLeave(day: string, token: string): Promise<LeaveRecord[]> {
  const domain = zohoDomain();
  const out: LeaveRecord[] = [];
  const LIMIT = 200;

  for (let start = 0; start < 2000; start += LIMIT) {
    const url = `${domain}/api/v2/leavetracker/leaves/records?` + new URLSearchParams({
      from: day, to: day,
      dateFormat: "yyyy-MM-dd",
      approvalStatus: '["APPROVED"]',
      dataSelect: "ALL",
      startIndex: String(start),
      limit: String(LIMIT),
    });
    const response = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    const json = await response.json();
    const page = unwrap(json);
    if (page.length === 0) {
      // Nothing, or a shape nobody has seen. Keep enough to tell the two apart:
      // "no leave today" and "the payload moved again" look identical otherwise,
      // and the second one silently stops suppressing prompts.
      if (start === 0) console.log(`zoho leave: 0 records, keys=${Object.keys(json ?? {}).join(",")}`);
      break;
    }
    out.push(...page);
    if (page.length < LIMIT) break;
  }
  return out;
}

Deno.serve(async (req) => {
  // Scheduled job, not a public endpoint. See _shared/auth.ts.
  const denied = await denyUnlessScheduler(req);
  if (denied) return denied;

  const fn = "mission-hq-leave";
  let body: { day?: string } = {};
  try { body = await req.json(); } catch { /* cron sends {} */ }

  const day = body.day || istToday();

  try {
    // Weekends and holidays have no prompts to suppress.
    const business = await pg("rpc/is_business_day", {
      method: "POST",
      body: JSON.stringify({ d: day }),
    });
    if (business !== true) {
      return Response.json({ ok: true, day, note: "not a business day" });
    }

    const token = await zohoAccessToken();
    const records = await approvedLeave(day, token);

    if (records.length === 0) {
      return Response.json({ ok: true, day, approved: 0, written: 0 });
    }

    const people = records.map((r) => ({
      emp_id: (r.EmployeeId || "").toString().trim() || null,
      name: (r.Employee || "").toString().trim(),
    }));

    const result = await pg("rpc/mark_leave", {
      method: "POST",
      body: JSON.stringify({ p_day: day, p_people: people }),
    }) as Array<{ matched: number; unmatched: Array<{ emp_id: string; name: string }> }>;

    const matched = result?.[0]?.matched ?? 0;
    const unmatched = result?.[0]?.unmatched ?? [];

    // Somebody on approved leave who could not be matched will be prompted,
    // will not answer, and will be scored Pending for it. That is worth saying
    // out loud rather than leaving in a log nobody reads.
    if (unmatched.length) {
      await alert(
        "Approved leave could not be matched to an employee",
        `${unmatched.length} of ${records.length} approved leave record(s) for ${day} matched ` +
        `neither an employee id nor a name:\n` +
        unmatched.map((u) => `• ${u.name || "(no name)"} (id ${u.emp_id || "none"})`).join("\n") +
        `\n\nThey will be prompted as usual and counted as Pending if they do not reply. ` +
        `Fixing it means their Employee ID in \`mission-hq.employees\` matching Zoho's.`,
        fn,
      );
    }

    return Response.json({ ok: true, day, approved: records.length, written: matched, unmatched: unmatched.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await alert("Zoho leave sync failed",
      `Nobody's approved leave was applied for ${day}, so people on leave will be prompted ` +
      `and counted as Pending. ${message}`, fn);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
