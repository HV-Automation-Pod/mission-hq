// ===========================================================================
// The 09:00 job: DM everybody who still needs to check in today.
//
// ONE RUN SENDS THE WHOLE ORG.
//
// Slack's ~1-per-second on chat.postMessage is PER CHANNEL, and every DM is a
// different channel, so it never binds here. An earlier version of this paced
// sequentially at 1/s as if the limit were global, which turned 400 messages
// into seven minutes of self-inflicted waiting and needed eleven cron jobs to
// work around. With a bounded worker pool the same 400 take well under a
// minute, inside one invocation, on two cron jobs.
//
// The drain property is kept anyway, because it is free: `prompt_recipients`
// excludes anybody who already has a row for today, so a re-run picks up only
// whoever is left. That is what makes a retry safe after a partial failure, and
// what lets the 10:00 check say "re-run it" rather than "investigate it".
//
// The row is written BEFORE the DM is sent, not after. If the write fails the
// person gets no message and shows up again next minute; if the DM fails after
// the row exists, the alert says so and a human can see it. The opposite order
// risks DMing somebody twice, which looks broken to them and is unfixable after
// the fact.
// ===========================================================================
import { pg, istToday } from "../_shared/pg.ts";
import { slack, alert } from "../_shared/slack.ts";

// Leaves headroom under the platform's wall clock for the final writes.
const BUDGET_MS = 110_000;

// In flight at once. Eight is well clear of anything Slack objects to across
// distinct channels, and keeps 400 sends under a minute. A 429 is still handled
// below rather than assumed away.
const CONCURRENCY = 8;

type Recipient = {
  email: string;
  full_name: string | null;
  slack_user_id: string | null;
};

Deno.serve(async () => {
  const started = Date.now();
  const day = istToday();
  const fn = "mission-hq-prompt";

  try {
    const recipients = await pg(
      "prompt_recipients?select=email,full_name,slack_user_id&order=email",
    ) as Recipient[];

    if (recipients.length === 0) {
      // Weekend, holiday, or everybody already has a row. All three are silence.
      return Response.json({ ok: true, day, sent: 0, remaining: 0, note: "nothing to send" });
    }

    const [rotation, locations, messages, trivia] = await Promise.all([
      pg("settings?select=value&key=eq.prompt_rotation"),
      pg("locations?select=value,label&active=is.true&order=sort_order"),
      pg("messages?select=ord,body&active=is.true&order=ord"),
      pg("trivia?select=ord,body&active=is.true&order=ord"),
    ]);

    const rot = rotation?.[0]?.value ?? { message_ord: 0, trivia_ord: 0 };
    // Take the entry at or after the cursor and wrap, so deleting an entry
    // nobody liked does not need the whole list renumbered.
    const pick = (rows: Array<{ ord: number; body: string }>, cursor: number) =>
      rows.find((r) => r.ord >= cursor) ?? rows[0];

    const greeting = pick(messages, rot.message_ord);
    const fact = pick(trivia, rot.trivia_ord);
    const token = Deno.env.get("MISSION_HQ_SLACK_BOT_TOKEN");
    if (!token) throw new Error("MISSION_HQ_SLACK_BOT_TOKEN is not set");

    const options = (locations as Array<{ value: string; label: string }>).map((l) => ({
      text: { type: "plain_text", text: l.label },
      value: l.value,
    }));

    let sent = 0;
    const noSlackId: string[] = [];
    const failed: string[] = [];
    const queue = [...recipients];

    const sendOne = async (person: Recipient) => {
      const name = (person.full_name || person.email.split("@")[0]).trim();
      const text = greeting.body.replace("{name}", name);
      const value = `submit_location_${day}_${fact.ord}|e=${encodeURIComponent(person.email)}`;

      // The row first — a failed write means no message and they reappear on
      // the next run; the reverse risks DMing somebody twice, which looks
      // broken to them and cannot be taken back.
      await pg("attendance?on_conflict=email,day", {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{
          email: person.email,
          day,
          status: "Pending",
          source: "prompt",
          prompted_at: new Date().toISOString(),
        }]),
      });

      const posted = await slack("chat.postMessage", token, {
        channel: person.slack_user_id,
        text,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `${text}\n\n*Fun Fact:* ${fact.body}` } },
          {
            type: "actions",
            elements: [
              { type: "static_select", action_id: "select_location",
                placeholder: { type: "plain_text", text: "Choose your location" }, options },
              { type: "button", action_id: "submit_location",
                text: { type: "plain_text", text: "Submit" }, style: "primary", value },
            ],
          },
        ],
      });

      if (!posted.ok) throw new Error(posted.error || "chat.postMessage failed");

      // Keep the message ts with the answer: the confirmation is a chat.update
      // of this message, and the Edit button reopens it weeks later.
      await pg(`attendance?email=eq.${encodeURIComponent(person.email)}&day=eq.${day}`, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({ slack_channel: posted.channel, message_ts: posted.ts }),
      });
    };

    // A fixed pool of workers pulling from one queue, rather than fixed-size
    // batches: a single slow send holds up one worker instead of stalling a
    // whole batch behind it.
    const worker = async () => {
      for (;;) {
        const person = queue.shift();
        if (!person) return;
        if (Date.now() - started > BUDGET_MS) return;

        // No Slack account means no way to ask them. The sheet used to skip
        // these in silence — somebody counted as not checked in for a message
        // that was never sendable.
        if (!person.slack_user_id) { noSlackId.push(person.email); continue; }

        try {
          await sendOne(person);
          sent++;
        } catch (error) {
          failed.push(`${person.email}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // Advance the rotation only on a day something actually went out, so
    // weekends and holidays never burn an entry — that is why the list lasts a
    // year rather than ten months. Only on the FIRST batch of the day: the
    // later batches must send the same greeting and fact as the first.
    if (sent > 0 && recipients.length === sent + failed.length + noSlackId.length) {
      const nextMessage = (messages.findIndex((m: {ord:number}) => m.ord === greeting.ord) + 1) % messages.length;
      const nextTrivia = (trivia.findIndex((t: {ord:number}) => t.ord === fact.ord) + 1) % trivia.length;
      await pg("settings?key=eq.prompt_rotation", {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({
          value: { message_ord: messages[nextMessage].ord, trivia_ord: trivia[nextTrivia].ord },
          updated_at: new Date().toISOString(),
        }),
      });

      // Trivia is finite. Running out silently makes every DM identical.
      if (trivia.length - nextTrivia <= 3) {
        await alert("Trivia list is nearly exhausted",
          `${trivia.length - nextTrivia} fact(s) left in \`mission-hq.trivia\`. Add more before it wraps.`, fn);
      }
    }

    if (noSlackId.length) {
      await alert("People have no Slack account and were not prompted",
        `${noSlackId.length} of ${recipients.length}:\n` + noSlackId.map((e) => `• ${e}`).join("\n") +
        `\n\nThey have no row in \`public.identity_links\`. Until that resolves they cannot be asked, ` +
        `and they will count as not checked in.`, fn);
    }
    if (failed.length) {
      await alert("Attendance prompts failed to send",
        failed.map((f) => `• ${f}`).join("\n"), fn);
    }

    const remaining = recipients.length - sent - noSlackId.length - failed.length;
    return Response.json({ ok: true, day, sent, failed: failed.length, noSlackId: noSlackId.length, remaining });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await alert("Attendance prompt job failed outright", `Nobody was prompted. ${message}`, fn);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
