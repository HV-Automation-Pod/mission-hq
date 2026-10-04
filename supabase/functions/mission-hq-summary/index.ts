// ===========================================================================
// The fortnightly attendance summary.
//
// SCHEDULED DAILY, FIRES TWICE A MONTH. `periodFor()` returns null on the ~28
// days that are neither the 1st nor the 16th and the run ends immediately.
//
// That is deliberate, and it fixes a bug that has already happened. Apps Script
// used two monthly triggers, one for each date. In the triggers UI they look
// like duplicates: same function, same hour, both showing "Last run: -" until
// one fires. On 2026-09-14 somebody deleted the 16th as a duplicate, two days
// before it was due, and the first half of that month was never reported. A job
// that wakes every morning and decides not to fire cannot be deleted by
// mistake, and a missed day is caught the next morning rather than next month.
//
// Double-posting is prevented by `summary_last_sent` in settings, not by the
// schedule, so a retry after a partial failure is safe.
//
// THREE MODES, and only one of them touches state:
//   send     real channels, writes scores and advances the snapshot number
//   test     everything to the test channel, writes NOTHING
//   preview  returns the blocks, posts nothing
// Test and preview must not write, or rehearsing the report silently corrupts
// the next one's deltas.
// ===========================================================================
import { pg } from "../_shared/pg.ts";
import { denyUnlessScheduler } from "../_shared/auth.ts";
import { slack, alert } from "../_shared/slack.ts";
import { periodFor, type Period } from "./period.ts";
import { buildMessage, type Member } from "./render.ts";

type Group = {
  key: string;
  name: string;
  channel_id: string;
  bot_username: string;
  last_scores: Record<string, number>;
  snapshot_no: number;
};

Deno.serve(async (req) => {
  // Scheduled job, not a public endpoint. See _shared/auth.ts.
  const denied = await denyUnlessScheduler(req);
  if (denied) return denied;

  const fn = "mission-hq-summary";
  let body: { mode?: string; group?: string; period?: Period } = {};
  try { body = await req.json(); } catch { /* cron sends {} */ }

  const mode = body.mode === "test" || body.mode === "preview" ? body.mode : "send";
  const real = mode === "send";

  try {
    // A period can be forced for a re-send or a dry run of a past fortnight.
    const period = body.period ?? periodFor();
    if (!period) {
      return Response.json({ ok: true, due: false, note: "not the 1st or the 16th" });
    }

    if (real) {
      const sent = await pg("settings?select=value&key=eq.summary_last_sent") as Array<{ value: string }>;
      if (sent?.[0]?.value === period.key) {
        return Response.json({ ok: true, due: true, period: period.key, note: "already sent" });
      }
    }

    const groups = await pg(
      "summary_groups?select=key,name,channel_id,bot_username,last_scores,snapshot_no" +
      "&active=is.true&order=sort_order" + (body.group ? `&key=eq.${body.group}` : ""),
    ) as Group[];

    const metrics = await pg("rpc/member_metrics", {
      method: "POST",
      body: JSON.stringify({ p_from: period.from, p_to: period.to }),
    }) as Array<Member & { email: string }>;
    const byEmail = new Map(metrics.map((m) => [m.email, m]));

    // Working days in the period: the days anybody was actually asked about.
    // Counted in SQL, not by fetching rows. PostgREST truncates at 1000
    // regardless of the limit asked for, which made this report "3 working
    // days" for a fortnight and, worse, gave the Wednesday count that decides
    // who the footnote names.
    const [{ working_days: workingDays, wednesdays }] = await pg("rpc/period_days", {
      method: "POST",
      body: JSON.stringify({ p_from: period.from, p_to: period.to }),
    }) as Array<{ working_days: number; wednesdays: number }>;

    const capRow = await pg("settings?select=value&key=eq.wfa_annual_cap") as Array<{ value: number }>;
    const wfaCap = Number(capRow?.[0]?.value ?? 15);

    const token = Deno.env.get("MISSION_HQ_SUMMARY_BOT_TOKEN") ||
                  Deno.env.get("MISSION_HQ_ALERT_BOT_TOKEN");
    if (!token) throw new Error("no summary bot token configured");
    const testChannel = Deno.env.get("MISSION_HQ_TEST_CHANNEL_ID") || "";

    const results: Array<Record<string, unknown>> = [];

    for (const group of groups) {
      const emails = (await pg(
        `group_members?select=email&group_key=eq.${group.key}`,
      ) as Array<{ email: string }>).map((r) => r.email);

      const all = emails
        .map((e) => byEmail.get(e))
        .filter((m): m is Member & { email: string } => !!m)
        .map((m) => ({
          ...m,
          delta: group.last_scores?.[m.email] === undefined
            ? null
            : m.standard_pct - group.last_scores[m.email],
          offWedDays: [] as string[],
        }));

      // available = 0 means on leave the whole period. Listed separately rather
      // than dumped into the bottom tier as if they had ignored the bot.
      const ranked = all.filter((m) => m.tier !== "X");
      const unranked = all.filter((m) => m.tier === "X");

      if (!ranked.length) {
        results.push({ group: group.key, skipped: "nobody to report" });
        continue;
      }

      // The dates behind the Wednesday footnote, fetched only for the people it
      // will actually name.
      const needDates = ranked.filter(
        (m) => m.tier !== "S" && m.tier !== "A" && m.pending === 0 && m.wfh_off_wed > 0,
      );
      if (needDates.length) {
        const list = needDates.map((m) => `"${m.email}"`).join(",");
        const rows = await pg(
          `attendance?select=email,day,status&email=in.(${list})` +
          `&day=gte.${period.from}&day=lte.${period.to}&status=in.("Home","Split Day","Half Day WFH Leave")`,
        ) as Array<{ email: string; day: string }>;
        for (const m of needDates) {
          m.offWedDays = rows
            .filter((r) => r.email === m.email)
            .filter((r) => {
              const [y, mo, d] = r.day.split("-").map(Number);
              return new Date(y, mo - 1, d).getDay() !== 3;
            })
            .map((r) => r.day)
            .sort();
        }
      }

      const message = buildMessage({
        groupName: group.name,
        period,
        snapshotNo: group.snapshot_no + 1,
        members: ranked,
        unranked,
        workingDays,
        wednesdays,
        wfaCap,
      });

      if (mode === "preview") {
        results.push({ group: group.key, members: ranked.length, blocks: message.blocks.length });
        continue;
      }

      const channel = mode === "test" ? testChannel : group.channel_id;
      if (!channel) { results.push({ group: group.key, error: "no channel" }); continue; }

      const posted = await slack("chat.postMessage", token, {
        channel,
        username: group.bot_username,
        text: message.text,
        // Each test copy says which channel it would really have gone to, so a
        // rehearsal cannot be mistaken for the real thing.
        blocks: mode === "test"
          ? [{ type: "context", elements: [{ type: "mrkdwn", text: `_would post to <#${group.channel_id}>_` }] },
             ...message.blocks]
          : message.blocks,
        unfurl_links: false,
      });
      if (!posted.ok) throw new Error(`${group.key}: ${posted.error}`);

      if (real) {
        // Only after a real post. Scores keyed by EMAIL so a renamed person
        // keeps their movement column.
        const scores: Record<string, number> = {};
        ranked.forEach((m) => { scores[m.email] = m.standard_pct; });
        await pg(`summary_groups?key=eq.${group.key}`, {
          method: "PATCH",
          headers: { prefer: "return=minimal" },
          body: JSON.stringify({
            last_scores: scores,
            last_period: period.key,
            snapshot_no: group.snapshot_no + 1,
          }),
        });
      }

      results.push({ group: group.key, members: ranked.length, channel, ts: posted.ts });
    }

    if (real) {
      await pg("settings?on_conflict=key", {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ key: "summary_last_sent", value: period.key }]),
      });
    }

    return Response.json({ ok: true, due: true, mode, period: period.key, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await alert("Fortnightly attendance summary failed",
      `Mode ${mode}. ${message}`, fn);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
