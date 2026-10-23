// mission-hq-answer-sync: what has to happen elsewhere when somebody answers
// from the DASHBOARD instead of in Slack.
//
// An answer in Slack does three more things the moment it is given: it tells
// Zoho, it rewrites the Slack message into its confirmation, and it sets the
// person's Slack status. An answer from the dashboard used to do none of them,
// so Zoho waited for the 19:30 sweep and the Slack message went on offering a
// question that had been answered.
//
// WHY THIS IS A FUNCTION AND NOT DASHBOARD CODE. The Zoho credentials, the
// Slack bot token and the Slack user token are secrets of the functions. The
// dashboard runs on Vercel and has none of them, and should not. So the
// dashboard saves the row and then calls this, and this does the rest with the
// same code the Slack handler uses (_shared/zoho-push.ts, _shared/slack-status.ts).
//
// EVERY PART IS BEST EFFORT AND INDEPENDENT. The answer is already saved by the
// time this runs. Zoho being down must not stop the Slack message updating, and
// neither may be anybody's error. Nothing here alerts per person (REVIEW.md
// 3.2): anything Zoho misses stays in `zoho_push_queue` and the 19:30 run
// reports it once, with a count.
//
// SLACK IS TOUCHED ONLY IF THERE IS SOMETHING TO TOUCH. The row records the DM
// it came from (`slack_channel`, `message_ts`). No DM recorded means no DM was
// sent, and none is sent now: this edits a message, it never creates one.

import { denyUnlessScheduler } from "../_shared/auth.ts";
import { istToday, pg } from "../_shared/pg.ts";
import { slack } from "../_shared/slack.ts";
import { setStatusForDay } from "../_shared/slack-status.ts";
import { owedRows, pushRows } from "../_shared/zoho-push.ts";

type Location = { value: string; label: string; status: string };

// Mirrors STATUS_CONFIG in mission-hq/index.ts, keyed by the Slack option value.
// Two copies, because the webhook is left untouched; change both together.
const PROFILE_STATUS: Record<string, { text: string; emoji: string }> = {
  "Home": { text: "WFH", emoji: ":working-from-home:" },
  "Compensatory-WFH": { text: "WFH", emoji: ":working-from-home:" },
  "Leave": { text: "On Leave", emoji: ":palm_tree:" },
  "Client-Location": { text: "Client Location", emoji: ":round_pushpin:" },
  "Travel": { text: "Travel", emoji: ":luggage:" },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── Zoho ────────────────────────────────────────────────────────────────────

async function syncZoho(email: string, day: string): Promise<string> {
  // Through `zoho_push_queue`, so eligibility (a Zoho id, not Pending, not
  // already sent) lives in one place. Nothing owed means nothing is sent.
  const rows = await owedRows({ email, day });
  if (rows.length === 0) return "nothing owed";
  const result = await pushRows(rows);
  if (result.failures.length) {
    console.error(`zoho push failed for ${email} on ${day}: ${result.failures.join("; ")}`);
    return "failed, left for the 19:30 run";
  }
  return "pushed";
}

// ── The Slack message ───────────────────────────────────────────────────────
//
// The button value formats below are the Slack handler's, and the Edit button
// parses what is written here: keep them in step with mission-hq/index.ts
// (splitActionValue, withStatus, packEditValue).

const EDIT_VALUE_MAX = 1900;

function splitValue(value: string) {
  const first = value.indexOf("|");
  if (first === -1) return { base: value, meta: "" };
  const second = value.indexOf("|", first + 1);
  return second === -1
    ? { base: value.slice(0, first), meta: value.slice(first + 1) }
    : { base: value.slice(0, first), meta: value.slice(first + 1, second) };
}

function buildEditValue(existing: string, answerValue: string, options: Location[], day: string, email: string): string {
  const { base, meta } = existing
    ? splitValue(existing)
    : { base: `submit_location_${day}_0`, meta: `e=${encodeURIComponent(email)}` };
  const params = new URLSearchParams(meta);
  params.set("s", answerValue); // the answer now on record, so Edit pre-selects it
  const head = `${base}|${params.toString()}`;
  const packed = `${head}|${JSON.stringify(options.map((o) => ({ t: o.label, v: o.value })))}`;
  return packed.length <= EDIT_VALUE_MAX ? packed : head;
}

async function syncSlackMessage(
  row: { status: string; slack_channel: string | null; message_ts: string | null },
  email: string,
  day: string,
  locations: Location[],
): Promise<string> {
  if (!row.slack_channel || !row.message_ts) return "no Slack message was sent, nothing to update";

  const token = Deno.env.get("MISSION_HQ_SLACK_BOT_TOKEN");
  if (!token) return "failed: no bot token";

  const chosen = locations.find((l) => l.status === row.status);
  if (!chosen) return `skipped: no picker option stores "${row.status}"`;

  // Read the message as it stands now, to keep its fun fact and its button
  // value. conversations.history is a read method, so it takes a query string,
  // not a JSON body.
  let existingText = "";
  let existingValue = "";
  try {
    const query = new URLSearchParams({ channel: row.slack_channel, latest: row.message_ts, inclusive: "true", limit: "1" });
    const res = await fetch(`https://slack.com/api/conversations.history?${query}`, { headers: { authorization: `Bearer ${token}` } });
    const body = await res.json() as { ok?: boolean; error?: string; messages?: Array<Record<string, unknown>> };
    const message = body.ok ? body.messages?.[0] : undefined;
    if (message && message.ts === row.message_ts) {
      const blocks = (message.blocks as Array<Record<string, unknown>> | undefined) ?? [];
      existingText = [
        String(message.text ?? ""),
        ...blocks.map((b) => String((b.text as { text?: string } | undefined)?.text ?? "")),
      ].join("\n\n");
      const actions = blocks.find((b) => b.type === "actions") as { elements?: Array<Record<string, unknown>> } | undefined;
      existingValue = String(actions?.elements?.find((e) => e.type === "button")?.value ?? "");
    } else if (!body.ok) {
      console.error(`conversations.history failed: ${body.error}`);
    }
  } catch (e) {
    console.error(`could not read the existing Slack message: ${errText(e)}`);
  }

  // A single line, like the handler: a greedy match would grow the fact on every edit.
  const fact = existingText.match(/\*Fun Fact:\*[ \t]*([^\n]*)/)?.[1]?.trim();
  const responseLine = `Thank you for your update! We received your response *${chosen.label}* for ${day}.`;
  const text = `${responseLine}${fact ? `\n\n*Fun Fact:* ${fact}` : ""}`;

  const result = await slack("chat.update", token, {
    channel: row.slack_channel,
    ts: row.message_ts,
    text: responseLine,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      {
        type: "actions",
        elements: [{
          type: "button",
          text: { type: "plain_text", text: "Edit", emoji: true },
          value: buildEditValue(existingValue, chosen.value, locations, day, email),
          action_id: "edit_location",
        }],
      },
    ],
  });
  return result.ok ? "updated" : `failed: ${result.error}`;
}

// ── The Slack profile status ────────────────────────────────────────────────

async function syncSlackStatus(email: string, day: string, status: string, locations: Location[]): Promise<string> {
  if (day !== istToday()) return "skipped: not today";
  const value = locations.find((l) => l.status === status)?.value ?? "";
  const cfg = PROFILE_STATUS[value];
  if (!cfg) return "skipped: this answer sets no status";

  const rows = await pg(
    `slack_active?select=slack_user_id&email=eq.${encodeURIComponent(email)}&order=updated_at.desc&limit=1`,
  ) as Array<{ slack_user_id: string }>;
  const userId = rows?.[0]?.slack_user_id;
  if (!userId) return "skipped: no Slack account found for this email";

  // Never overwrites a status somebody already has: see _shared/slack-status.ts.
  return (await setStatusForDay(userId, cfg, day)) ? "set" : "left alone, a status was already there";
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const denied = await denyUnlessScheduler(request);
  if (denied) return denied;

  let input: { email?: unknown; day?: unknown };
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const email = String(input.email ?? "").trim().toLowerCase();
  const day = String(input.day ?? "");
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return json({ ok: false, error: "email and day (yyyy-MM-dd) are required" }, 400);
  }

  try {
    // What is stored decides everything, not what the caller says happened.
    const rows = await pg(
      `attendance?select=status,slack_channel,message_ts&email=eq.${encodeURIComponent(email)}&day=eq.${day}`,
    ) as Array<{ status: string; slack_channel: string | null; message_ts: string | null }>;
    const row = rows?.[0];
    if (!row) return json({ ok: true, skipped: "no attendance row" });
    if (row.status === "Pending") return json({ ok: true, skipped: "still Pending, not an answer" });

    const locations = await pg("locations?select=value,label,status&active=is.true&order=sort_order") as Location[];

    const settle = async (job: () => Promise<string>) => {
      try { return await job(); } catch (e) { console.error(errText(e)); return `failed: ${errText(e)}`; }
    };
    const [zoho, slackMessage, slackStatus] = await Promise.all([
      settle(() => syncZoho(email, day)),
      settle(() => syncSlackMessage(row, email, day, locations)),
      settle(() => syncSlackStatus(email, day, row.status, locations)),
    ]);

    return json({ ok: true, zoho, slackMessage, slackStatus });
  } catch (e) {
    console.error(errText(e));
    return json({ ok: false, error: errText(e) }, 500);
  }
});
