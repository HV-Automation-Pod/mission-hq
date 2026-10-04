// ===========================================================================
// Tell somebody they have been given access to the dashboard.
//
// Granting access is a thing done TO a person, in a screen they cannot see,
// and until now nothing told them it had happened. They would find out by
// being told in a meeting, or not at all. The grant is also the only moment
// where explaining the two levels is useful, so the DM carries that rather
// than leaving them to discover which one they got by trying to click things.
//
// THE DM MUST NEVER FAIL THE GRANT. Access lives in `dashboard_access`; this
// is a courtesy on top of it. A Slack outage, a person with no Slack account,
// a renamed workspace: all of those return a reason, and the row stays. The
// caller surfaces the reason rather than rolling anything back.
// ===========================================================================
import { pg } from "../_shared/pg.ts";
import { denyUnlessScheduler } from "../_shared/auth.ts";
import { slack } from "../_shared/slack.ts";

type Body = {
  email: string;
  can_edit?: boolean;
  granted_by?: string;
  note?: string;
  /** Where the dashboard actually is. The caller is serving it, so it knows. */
  dashboard_url?: string;
};

Deno.serve(async (request) => {
  // Scheduled job, not a public endpoint. See _shared/auth.ts.
  const denied = await denyUnlessScheduler(request);
  if (denied) return denied;

  const token = Deno.env.get("MISSION_HQ_SLACK_BOT_TOKEN");
  if (!token) return Response.json({ ok: false, reason: "no bot token" }, { status: 500 });

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "bad request body" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email) return Response.json({ ok: false, reason: "no email" }, { status: 400 });

  // `slack_active` rather than identity_links: a deactivated account still has
  // a row there, and DMing a switched-off account succeeds silently, which
  // would report success for a message nobody can read.
  const links = await pg(
    `slack_active?select=email,slack_user_id&email=eq.${encodeURIComponent(email)}&limit=1`,
  ) as Array<{ slack_user_id: string }>;
  const userId = links?.[0]?.slack_user_id;
  if (!userId) {
    return Response.json({ ok: false, reason: "no active Slack account for that address" });
  }

  const people = await pg(
    `employees?select=full_name&email=eq.${encodeURIComponent(email)}&limit=1`,
  ) as Array<{ full_name: string | null }>;
  const name = people?.[0]?.full_name?.split(" ")[0] || email.split("@")[0];

  const canEdit = body.can_edit === true;
  const grantedBy = (body.granted_by || "").split("@")[0];

  // What they can do, in the words of the thing they will actually click.
  const whatTheyCan = canEdit
    ? "You can view everyone's attendance and make changes: exemptions, prompt overrides, site corrections and rosters."
    : "You can view everyone's attendance. Changes are left to editors, so nothing you do can alter a record.";

  const lines = [
    `Hi ${name}, you now have admin access to the MissionHQ dashboard.`,
    "",
    whatTheyCan,
  ];
  if (body.note?.trim()) lines.push("", `Reason given: ${body.note.trim()}`);
  if (grantedBy) lines.push("", `Granted by ${grantedBy}.`);

  const text = lines.join("\n");

  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `Hi ${name}, you now have *admin access* to the MissionHQ dashboard.` },
    },
    { type: "section", text: { type: "mrkdwn", text: whatTheyCan } },
  ];

  const context: string[] = [];
  if (body.note?.trim()) context.push(`Reason: ${body.note.trim()}`);
  if (grantedBy) context.push(`Granted by ${grantedBy}`);
  if (context.length) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: context.join("  ·  ") }],
    });
  }

  const url = body.dashboard_url?.trim();
  if (url && /^https?:\/\//.test(url)) {
    blocks.push({
      type: "actions",
      elements: [{
        type: "button",
        text: { type: "plain_text", text: "Open the dashboard" },
        url,
        style: "primary",
      }],
    });
  }

  const posted = await slack("chat.postMessage", token, {
    channel: userId,
    text,
    blocks,
  });

  if (!posted.ok) {
    return Response.json({ ok: false, reason: posted.error || "chat.postMessage failed" });
  }
  return Response.json({ ok: true, channel: posted.channel, ts: posted.ts });
});
