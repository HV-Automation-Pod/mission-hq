// ===========================================================================
// The 10:00 job: did everybody actually get asked?
//
// It reads `prompt_gaps`, which is the same view the 09:00 sender drains. If
// the send worked, it is empty and this function says nothing at all. Anything
// left in it is a person who will be counted as not checked in for a message
// they never received — which is the failure worth interrupting somebody for,
// and the one the spreadsheet could never see cheaply.
//
// It also catches the sender failing ENTIRELY, with no special case: a cron
// that never fired leaves every single person in the view, which is simply the
// loudest possible version of the same alert.
//
// There is deliberately no "all good" message. You asked for an alert when
// something is wrong, not a daily heartbeat — a job that reports success every
// morning is one people stop reading, and then the one that matters scrolls
// past with the rest.
// ===========================================================================
import { pg, istToday } from "../_shared/pg.ts";
import { alert } from "../_shared/slack.ts";

type Gap = { email: string; full_name: string | null; slack_user_id: string | null };

Deno.serve(async () => {
  const day = istToday();
  const fn = "mission-hq-verify";

  try {
    const gaps = await pg(
      "prompt_gaps?select=email,full_name,slack_user_id&order=email",
    ) as Gap[];

    if (gaps.length === 0) {
      // Weekend, holiday, or everybody was asked. Silence is the healthy state.
      return Response.json({ ok: true, day, gaps: 0 });
    }

    // Split them, because the two halves need different people to act. A
    // missing Slack account is for whoever owns the directory; everything else
    // is a bug in the send path.
    const noAccount = gaps.filter((g) => !g.slack_user_id);
    const shouldHaveWorked = gaps.filter((g) => g.slack_user_id);

    const lines = (rows: Gap[]) =>
      rows.map((g) => `• ${g.full_name || g.email} — ${g.email}`).join("\n");

    const detail = [
      `*${gaps.length}* person/people have no attendance row for *${day}*.`,
      shouldHaveWorked.length
        ? `\n*Had a Slack account and still were not asked (${shouldHaveWorked.length}):*\n` +
          lines(shouldHaveWorked)
        : "",
      noAccount.length
        ? `\n*No Slack account in \`public.identity_links\` (${noAccount.length}):*\n` + lines(noAccount)
        : "",
      `\nThey will count as not checked in for a message they never got. ` +
      `Re-running \`mission-hq-prompt\` is safe and will pick them up.`,
    ].filter(Boolean).join("\n");

    await alert(
      gaps.length === 1
        ? "1 employee did not get today's attendance message"
        : `${gaps.length} employees did not get today's attendance message`,
      detail,
      fn,
    );

    return Response.json({ ok: true, day, gaps: gaps.length, alerted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The checker failing is its own alert: a silent verifier is indis-
    // tinguishable from a clean morning, which is the exact trap this replaces.
    await alert("Attendance verification could not run",
      `Nobody checked whether today's prompts went out. ${message}`, fn);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
