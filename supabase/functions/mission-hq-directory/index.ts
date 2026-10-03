// ===========================================================================
// Slack directory housekeeping: who has left, and who is a manager.
//
// Two jobs that both need the Slack API and nothing else, so they share a run.
//
// 1. DEACTIVATED ACCOUNTS. Somebody whose Slack account is switched off but
//    who is still in the Zoho feed would otherwise be prompted every working
//    day for ever. Slack keeps a deactivated user's DM channel alive, so
//    chat.postMessage KEEPS SUCCEEDING: the prompt "sends", the row says
//    Pending, and the fortnightly report ranks them at 0% and names them in
//    the call-out. That is exactly how somebody offboarded months earlier was
//    still in a published snapshot.
//
//    "Has no Slack account" is NOT the signal, and the difference is the whole
//    point. A new hire is in Zoho days before they get a Slack account, and
//    marking them exempt would silence their prompts for ever. Only a positive
//    `deleted: true` from users.list counts. `public.identity_links` cannot
//    answer this — it drops deactivated users entirely, so absence there is
//    ambiguous. This asks Slack directly.
//
// 2. THE MANAGERS ROSTER. Its membership is the member list of its own Slack
//    channel, because that is the list somebody actually maintains: people are
//    added to it when they become a manager. It was seeded once from the
//    spreadsheet and has never refreshed since.
// ===========================================================================
import { pg } from "../_shared/pg.ts";
import { slack, alert } from "../_shared/slack.ts";

const MANAGERS_CHANNEL = "C061H34DECA";

type Member = { id: string; deleted?: boolean; is_bot?: boolean; profile?: { email?: string } };

/** Whole member list, paginated. Tier 2, so a short pause between pages. */
async function slackDirectory(token: string): Promise<Member[]> {
  const out: Member[] = [];
  let cursor = "";
  for (let page = 0; page < 25; page++) {
    const url = `https://slack.com/api/users.list?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const json = await response.json();
    if (!json.ok) throw new Error(`users.list: ${json.error}`);
    out.push(...(json.members || []));
    cursor = json.response_metadata?.next_cursor || "";
    if (!cursor) break;
    await new Promise((r) => setTimeout(r, 1200));
  }
  return out;
}

Deno.serve(async () => {
  const fn = "mission-hq-directory";
  const results: Record<string, unknown> = {};

  const botToken = Deno.env.get("MISSION_HQ_SLACK_BOT_TOKEN");
  if (!botToken) {
    await alert("Directory housekeeping could not run", "MISSION_HQ_SLACK_BOT_TOKEN is not set", fn);
    return Response.json({ ok: false, error: "no bot token" }, { status: 500 });
  }

  // ---- 1. Retire people whose Slack account has been switched off ---------
  try {
    const members = await slackDirectory(botToken);
    const deactivated = new Set(
      members
        .filter((m) => m.deleted === true && !m.is_bot && m.profile?.email)
        .map((m) => m.profile!.email!.toLowerCase()),
    );

    const active = await pg(
      "employees?select=email,full_name&exited_at=is.null&wfo_exempt=is.null&limit=2000",
    ) as Array<{ email: string; full_name: string }>;
    const toRetire = active.filter((e) => deactivated.has(e.email));

    for (const person of toRetire) {
      await pg(`employees?email=eq.${encodeURIComponent(person.email)}`, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({
          wfo_exempt: `Slack account deactivated (${new Date().toISOString().slice(0, 10)})`,
          updated_at: new Date().toISOString(),
        }),
      });
    }

    // Alerted, not just logged: this stops somebody being messaged and removes
    // them from a published ranking, so a wrong one has to be visible enough
    // to undo. Clearing the WFO Exempt cell puts anyone straight back.
    if (toRetire.length) {
      await alert(
        `${toRetire.length} person/people retired: Slack account deactivated`,
        toRetire.map((p) => `• ${p.full_name || p.email} (${p.email})`).join("\n") +
        `\n\nThey will no longer be prompted or appear in attendance summaries. ` +
        `Clear their \`wfo_exempt\` value to undo.`,
        fn,
      );
    }
    results.deactivated_retired = toRetire.length;
  } catch (error) {
    results.deactivated_error = error instanceof Error ? error.message : String(error);
    await alert("Could not check for deactivated Slack accounts",
      `Leavers may still be prompted and may still appear in summaries. ${results.deactivated_error}`, fn);
  }

  // ---- 2. Rebuild the Managers roster from its Slack channel -------------
  try {
    // The attendance bot is not in that channel and gets `channel_not_found`;
    // the HV Automation bot is. Tried in that order so a fix to either works.
    const tokens = [
      Deno.env.get("MISSION_HQ_ALERT_BOT_TOKEN"),
      botToken,
    ].filter(Boolean) as string[];

    // GET with query parameters, not a JSON body. Slack's READ methods reject
    // `application/json` with `invalid_arguments`, which names no argument and
    // reads like the channel id is wrong. Only the write methods take JSON.
    let ids: string[] = [];
    let lastError = "";
    for (const token of tokens) {
      const url = `https://slack.com/api/conversations.members` +
                  `?channel=${encodeURIComponent(MANAGERS_CHANNEL)}&limit=1000`;
      const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      const json = await response.json();
      if (json.ok) { ids = json.members || []; break; }
      lastError = json.error;
    }
    if (!ids.length) throw new Error(`conversations.members: ${lastError || "no members"}`);

    // Emails come from identity_links where possible: free, and an exact join.
    const links = await pg("identity_links?select=email,slack_user_id&limit=2000", { profile: "public" }) as
      Array<{ email: string; slack_user_id: string }>;
    const byId = new Map(links.filter((l) => l.slack_user_id).map((l) => [l.slack_user_id, l.email]));

    const emails: string[] = [];
    const unresolved: string[] = [];
    for (const id of ids) {
      const email = byId.get(id);
      if (email) emails.push(email.toLowerCase());
      else unresolved.push(id);
    }

    const replaced = await pg("rpc/replace_roster", {
      method: "POST",
      body: JSON.stringify({ p_group: "managers", p_emails: emails }),
    }) as Array<{ added: number; removed: number }>;

    // A bot in that channel is expected and says nothing. A PERSON who cannot
    // be resolved is a missing row in a published ranking, so it is alerted.
    // Deactivated accounts are gone from identity_links, so some of these are
    // simply leavers still sitting in the channel.
    if (unresolved.length) {
      await alert(
        `${unresolved.length} managers-channel member(s) could not be resolved to an email`,
        `Slack ids: ${unresolved.join(", ")}\n\nBots are expected here. A person missing from ` +
        `\`public.identity_links\` is either deactivated or newly joined, and will be absent ` +
        `from the Managers attendance summary until they appear.`,
        fn,
      );
    }

    results.managers = { members: ids.length, resolved: emails.length, ...replaced?.[0] };
  } catch (error) {
    results.managers_error = error instanceof Error ? error.message : String(error);
    // The summary still posts, but against last time's roster, and "silently
    // short report" is the exact failure this job replaces.
    await alert("Managers roster refresh failed",
      `The Managers summary will use the roster from last time. ${results.managers_error}`, fn);
  }

  return Response.json({ ok: true, ...results });
});
