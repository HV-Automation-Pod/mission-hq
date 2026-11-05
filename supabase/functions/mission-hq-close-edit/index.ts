// mission-hq-close-edit: removes the Edit button from the DMs of days that have
// ended. Runs from 00:15 IST (see migration 55).
//
// The webhook already refuses an Edit click on a past day, so this is the
// cosmetic half: the button simply stops being offered. It never creates or
// deletes a message, and it only ever removes the Edit button.
//
// WHAT IT TOUCHES. The `edit_closable` view: answered rows for the last five
// days that have a recorded DM and are not in the ledger. A Pending row is not
// in it, because its message carries the picker and Submit.
//
// EACH MESSAGE IS READ BEFORE IT IS CHANGED. A row's message is not always the
// confirmation (approved leave is written without the DM being rewritten, so
// the message can still be the picker). Only a message that actually has an
// `edit_location` button is edited, and only that block is removed; the text and
// everything else stay exactly as they were.
//
// IT DRAINS. Rows are stamped in `slack_edit_closed` as they are handled, so a
// run that stops at its time budget, or a rate limit, is resumed by the next
// call. The pace stays under Slack's roughly 50 calls a minute for each method.

import { denyUnlessScheduler } from "../_shared/auth.ts";
import { pg } from "../_shared/pg.ts";
import { alert, slack } from "../_shared/slack.ts";

const BUDGET_MS = 110_000;
const BATCH = 100;
// Two Slack calls per message, each method limited separately to about 50 a
// minute. One message every 1.25 seconds stays just under that.
const PACE_MS = 1250;

type Row = { email: string; day: string; slack_channel: string; message_ts: string };
type Block = Record<string, unknown>;
type History = { ok?: boolean; error?: string; messages?: Array<{ ts?: string; text?: string; blocks?: Block[] }> };

// Errors that mean this message cannot or need not be changed. They are final,
// so the row is stamped and not retried every three minutes for ever.
const FINAL = new Set([
  "message_not_found", "channel_not_found", "cant_update_message", "edit_window_closed",
  "is_inactive", "user_not_found", "account_inactive", "not_in_channel",
]);

// Slack having a bad moment: stop the run and let the next one retry, rather
// than stamping a message that was never actually checked.
const TRANSIENT = new Set(["ratelimited", "service_unavailable", "internal_error", "fatal_error", "request_timeout"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// conversations.history is a read method, so it takes a query string.
async function readMessage(token: string, row: Row, attempt = 1): Promise<History> {
  const query = new URLSearchParams({ channel: row.slack_channel, latest: row.message_ts, inclusive: "true", limit: "1" });
  const res = await fetch(`https://slack.com/api/conversations.history?${query}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 429 && attempt < 3) {
    const after = Number(res.headers.get("retry-after")) || 1;
    await res.body?.cancel();
    await sleep(Math.min(after, 30) * 1000);
    return readMessage(token, row, attempt + 1);
  }
  try {
    return await res.json() as History;
  } catch {
    return { ok: false, error: `non-JSON response (HTTP ${res.status})` };
  }
}

const hasEdit = (block: Block) =>
  block.type === "actions" &&
  ((block.elements as Array<Record<string, unknown>> | undefined) ?? []).some((e) => e.action_id === "edit_location");

async function stamp(row: Row) {
  await pg("slack_edit_closed?on_conflict=email,day", {
    method: "POST",
    headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ email: row.email, day: row.day }),
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const denied = await denyUnlessScheduler(request);
  if (denied) return denied;

  const token = Deno.env.get("MISSION_HQ_SLACK_BOT_TOKEN");
  if (!token) return json({ ok: false, error: "MISSION_HQ_SLACK_BOT_TOKEN is not set" }, 500);

  const started = Date.now();
  const tally = { closed: 0, untouched: 0, gaveUp: 0, unexpected: 0 };
  let firstUnexpected = "";
  let stoppedEarly = "";

  try {
    // Newest days first, so yesterday is done before the older backlog.
    const rows = await pg(`edit_closable?select=email,day,slack_channel,message_ts&order=day.desc&limit=${BATCH}`) as Row[];

    for (const row of rows ?? []) {
      if (Date.now() - started > BUDGET_MS) { stoppedEarly = "time budget"; break; }
      const turnStart = Date.now();

      const history = await readMessage(token, row);
      if (history.error && TRANSIENT.has(history.error)) { stoppedEarly = history.error; break; }

      let message = history.ok ? history.messages?.[0] : undefined;
      if (message && message.ts !== row.message_ts) message = undefined;

      if (!history.ok || !message) {
        // A message we cannot read cannot be changed. It is stamped either way so
        // one bad row never starves the queue; unexpected errors are counted and
        // reported once at the end.
        if (history.ok || (history.error && FINAL.has(history.error))) { await stamp(row); tally.gaveUp++; }
        else { await stamp(row); tally.unexpected++; firstUnexpected ||= `history: ${history.error}`; }
      } else {
        const blocks = message.blocks ?? [];
        if (!blocks.some(hasEdit)) {
          await stamp(row);
          tally.untouched++;
        } else {
          const result = await slack("chat.update", token, {
            channel: row.slack_channel,
            ts: row.message_ts,
            text: message.text ?? "",
            blocks: blocks.filter((b) => !hasEdit(b)),
          });
          if (result.ok) { await stamp(row); tally.closed++; }
          else if (result.error && TRANSIENT.has(result.error)) { stoppedEarly = result.error; break; }
          else if (result.error && FINAL.has(result.error)) { await stamp(row); tally.gaveUp++; }
          else { await stamp(row); tally.unexpected++; firstUnexpected ||= `update: ${result.error}`; }
        }
      }

      const spent = Date.now() - turnStart;
      if (spent < PACE_MS) await sleep(PACE_MS - spent);
    }
  } catch (e) {
    console.error(errText(e));
    await alert("close-edit failed", errText(e), "mission-hq-close-edit");
    return json({ ok: false, error: errText(e) }, 500);
  }

  // One alert per run, and only when something needs a human. A message that
  // was simply gone is not one.
  if (tally.unexpected > 0) {
    await alert("close-edit could not update some messages", `${tally.unexpected} failed, first: ${firstUnexpected}`, "mission-hq-close-edit");
  }
  return json({ ok: true, ...tally, stoppedEarly: stoppedEarly || null });
});
