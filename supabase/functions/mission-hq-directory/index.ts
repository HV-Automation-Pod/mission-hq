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
//    `deleted: true` from users.list counts. This asks Slack directly rather
//    than inferring it from `public.identity_links`, which only ever tells us
//    when an account was last SEEN.
//
// 2. THE MANAGERS ROSTER. Its membership is the member list of its own Slack
//    channel, because that is the list somebody actually maintains: people are
//    added to it when they become a manager. It was seeded once by hand and
//    has never refreshed since.
// ===========================================================================
import { pg } from "../_shared/pg.ts";
import { denyUnlessScheduler } from "../_shared/auth.ts";
import { slack, alert } from "../_shared/slack.ts";

const MANAGERS_CHANNEL = "C061H34DECA";

type Member = {
  id: string;
  deleted?: boolean;
  is_bot?: boolean;
  /** Multi-channel guest. */
  is_restricted?: boolean;
  /** Single-channel guest. */
  is_ultra_restricted?: boolean;
  real_name?: string;
  profile?: { email?: string; real_name?: string; display_name?: string };
};

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
  // The page cap is a runaway guard, not a size limit, and the caller REPLACES
  // the whole snapshot with what comes back. Exiting with a cursor still set
  // means the list is truncated, and replacing a full snapshot with a partial
  // one would silently drop everybody past the cap out of `slack_active`: off
  // the Slack-vs-Zoho audit, and out of the Managers roster resolution. At
  // ~2300 accounts there is room, which is exactly when this is cheap to add.
  if (cursor) throw new Error("users.list did not finish paging; refusing to replace the snapshot with a truncated list");
  return out;
}

Deno.serve(async (request) => {
  // Scheduled job, not a public endpoint. See _shared/auth.ts.
  const denied = await denyUnlessScheduler(request);
  if (denied) return denied;

  const fn = "mission-hq-directory";
  const results: Record<string, unknown> = {};

  const botToken = Deno.env.get("MISSION_HQ_SLACK_BOT_TOKEN");
  if (!botToken) {
    await alert("Directory housekeeping could not run", "MISSION_HQ_SLACK_BOT_TOKEN is not set", fn);
    return Response.json({ ok: false, error: "no bot token" }, { status: 500 });
  }

  // ---- 0. Keep what Slack said -------------------------------------------
  //
  // One users.list call already pages the whole workspace below, and until now
  // everything except `deleted` was discarded. Two questions nothing else can
  // answer live in this response: whether an account is switched off, and
  // whether the person is a GUEST. The second has no proxy — guests here hold
  // @hyperverge.co addresses — so without this they were indistinguishable
  // from staff in the Slack-vs-Zoho audit.
  let members: Member[] = [];
  try {
    members = await slackDirectory(botToken);
    const snapshot = members.map((m) => ({
      id: m.id,
      email: m.profile?.email ?? null,
      name: m.profile?.display_name || m.profile?.real_name || m.real_name || null,
      is_bot: m.is_bot === true,
      is_guest: m.is_restricted === true || m.is_ultra_restricted === true,
      deleted: m.deleted === true,
    }));
    const counts = await pg("rpc/sync_slack_accounts", {
      method: "POST",
      body: JSON.stringify({ p_rows: snapshot }),
    }) as Array<Record<string, number>>;
    results.slack_accounts = counts?.[0] ?? { total: snapshot.length };
  } catch (error) {
    results.slack_accounts_error = error instanceof Error ? error.message : String(error);
    // Not fatal to the rest of the run, but the audit and the Managers roster
    // are now reading a snapshot that is one or more days stale, and that is
    // invisible from the dashboard unless somebody is told.
    await alert("Could not refresh the Slack account snapshot",
      `The Slack vs Zoho audit and the Managers roster are working from the previous ` +
      `snapshot. Guests and leavers may be stale. ${results.slack_accounts_error}`, fn);
  }

  // ---- 1. Retire people whose Slack account has been switched off ---------
  try {
    if (!members.length) members = await slackDirectory(botToken);
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

    // Emails come from `mission-hq.slack_active`, not from identity_links
    // directly. The sync UPSERTS AND NEVER DELETES, so a deactivated account
    // keeps its row for ever — and a leaver still sitting in the managers
    // channel would resolve perfectly here and be written straight back onto
    // the roster, putting them in the fortnightly report at 0%. That is the
    // exact failure the first half of this job exists to prevent.
    const links = await pg("slack_active?select=email,slack_user_id&limit=2000") as
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

    // An unresolved id is only worth a human's attention if it is a PERSON.
    //
    // The first version of this alerted on the raw count, and the text said
    // "bots are expected here" while alerting about three of them — Polly,
    // Notion, and this alert's own sender. It fired on every run, for a
    // condition that is permanent and correct, into a shared channel. §3.2:
    // an alert that cannot be acted on trains people to ignore the ones that
    // can.
    //
    // `slack_accounts` can now say which is which, so classify first and alert
    // only on what is left.
    const classified = unresolved.length
      ? await pg(
          `slack_accounts?select=slack_user_id,display_name,is_bot,is_guest,deleted` +
          `&slack_user_id=in.(${unresolved.map(encodeURIComponent).join(",")})`,
        ) as Array<{ slack_user_id: string; display_name: string | null; is_bot: boolean; is_guest: boolean; deleted: boolean }>
      : [];
    const accountById = new Map(classified.map((c) => [c.slack_user_id, c]));

    const expected: string[] = [];
    const unexplained: string[] = [];
    for (const id of unresolved) {
      const c = accountById.get(id);
      // Unknown to the snapshot means newly joined, which IS worth saying:
      // they are missing from the Managers summary until the sync catches up.
      if (c && (c.is_bot || c.is_guest || c.deleted)) expected.push(id);
      else unexplained.push(id);
    }

    results.managers_unresolved = { expected: expected.length, unexplained: unexplained.length };

    if (unexplained.length) {
      await alert(
        `${unexplained.length} managers-channel member(s) could not be resolved to an email`,
        `Slack ids: ${unexplained.join(", ")}\n\nThese are people, not bots or guests, and they ` +
        `will be absent from the Managers attendance summary until they resolve. Most likely a ` +
        `manager who joined since the last nightly Slack sync.` +
        (expected.length
          ? `\n\n(${expected.length} other channel member(s) were bots, guests or deactivated ` +
            `accounts. Those are excluded on purpose and are not a problem.)`
          : ""),
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
