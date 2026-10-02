// ===========================================================================
// The 14:00 job: nudge whoever is still Pending.
//
// IN-THREAD, NOT A NEW DM. The reminder is a threaded reply to this morning's
// prompt, which is why `message_ts` is kept on the attendance row. A fresh DM
// would sit below the original and read as the bot having lost it.
//
// WHAT THIS NO LONGER NEEDS TO DO.
// The Apps Script version re-read each person's Slack DM before nudging them,
// because the sheet write could be lost after the confirmation was shown — so
// "Pending" did not reliably mean "has not answered", and people were nagged 14
// minutes after replying. That check cost one rate-limited Slack call per
// pending person and ran under a 3.5-minute budget, past which it was skipped.
//
// It is gone because the thing it compensated for is gone: the answer is now
// upserted straight into the row this job reads. What remains is a re-read of
// that row immediately before posting, which is a single indexed lookup and
// closes the seconds-wide gap between selecting the list and working through it.
// ===========================================================================
import { pg, istToday } from "../_shared/pg.ts";
import { slack, alert } from "../_shared/slack.ts";

const CONCURRENCY = 8;

type Pending = {
  email: string;
  full_name: string | null;
  slack_channel: string;
  message_ts: string;
};

Deno.serve(async () => {
  const day = istToday();
  const fn = "mission-hq-remind";

  try {
    const pending = await pg(
      "reminder_recipients?select=email,full_name,slack_channel,message_ts&order=email",
    ) as Pending[];

    if (pending.length === 0) {
      return Response.json({ ok: true, day, reminded: 0, note: "nobody pending" });
    }

    const token = Deno.env.get("MISSION_HQ_SLACK_BOT_TOKEN");
    if (!token) throw new Error("MISSION_HQ_SLACK_BOT_TOKEN is not set");

    let reminded = 0;
    let answeredMeanwhile = 0;
    const failed: string[] = [];
    const queue = [...pending];

    const worker = async () => {
      for (;;) {
        const person = queue.shift();
        if (!person) return;

        try {
          // Answered since the list was taken? Being nudged after replying reads
          // as the bot losing your response, and it is the complaint that
          // reaches PnC. One indexed read is cheap insurance against it.
          const live = await pg(
            `attendance?select=status&email=eq.${encodeURIComponent(person.email)}&day=eq.${day}`,
          ) as Array<{ status: string }>;
          if (live[0]?.status !== "Pending") { answeredMeanwhile++; continue; }

          const name = (person.full_name || person.email.split("@")[0]).split(" ")[0];
          const posted = await slack("chat.postMessage", token, {
            channel: person.slack_channel,
            thread_ts: person.message_ts,
            text: `${name}, a quick nudge — your check-in for ${day} is still open. ` +
                  `Pick an option above and hit Submit whenever you get a moment.`,
          });
          if (!posted.ok) throw new Error(posted.error || "chat.postMessage failed");
          reminded++;
        } catch (error) {
          failed.push(`${person.email}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    if (failed.length) {
      await alert("Attendance reminders failed to send",
        failed.map((f) => `• ${f}`).join("\n"), fn);
    }

    return Response.json({ ok: true, day, pending: pending.length, reminded, answeredMeanwhile, failed: failed.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await alert("Attendance reminder job failed outright",
      `Nobody was nudged today. ${message}`, fn);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
