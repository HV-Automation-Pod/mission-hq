"use server";

import { revalidatePath } from "next/cache";
import { requireDb } from "./db";
import { headers } from "next/headers";
import { getViewer } from "./session";

/**
 * Everything the dashboard can change, and the only place it may.
 *
 * Every action re-checks the viewer. A server action is a public endpoint with
 * a generated name, not a private function: checking permission in the page
 * that draws the button protects the button, not the action behind it.
 *
 * `can_edit` is separate from being an admin. Most people who need this tool
 * need to read it; changing somebody's attendance record is a different thing.
 */
async function editor() {
  const viewer = await getViewer();
  if (!viewer) throw new Error("Not signed in");
  if (viewer.role !== "admin") throw new Error("Admins only");
  if (!viewer.canEdit) throw new Error("You have read-only access to MissionHQ");
  return viewer;
}

/** Stop prompting somebody, or start again. A reason is kept, not a boolean. */
export async function setExempt(email: string, reason: string | null) {
  const viewer = await editor();
  const value = reason?.trim()
    ? `${reason.trim()} (set by ${viewer.email.split("@")[0]}, ${new Date().toISOString().slice(0, 10)})`
    : null;
  const { error } = await requireDb()
    .from("employees")
    .update({ wfo_exempt: value, updated_at: new Date().toISOString() })
    .eq("email", email);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/people");
  revalidatePath("/admin/triage");
}

/**
 * "Prompt this person anyway." The human override for the case the automatic
 * signals get wrong: a live employee whose HR record sits under a different
 * email, so the Zoho feed never lists them.
 */
export async function setPromptOptIn(email: string, optIn: boolean, note?: string) {
  await editor();
  const db = requireDb();
  const { data: existing } = await db.from("employees").select("email").eq("email", email).maybeSingle();

  if (!existing) {
    // Somebody on the Slack-vs-Zoho list with no employee row yet. Creating it
    // is the point: an answer that silently does nothing is worse than none.
    const { error } = await db.from("employees").insert({
      email, full_name: email.split("@")[0], prompt_opt_in: optIn, notes: note ?? null,
    });
    if (error) throw new Error(error.message);
  } else {
    const patch: Record<string, unknown> = { prompt_opt_in: optIn, updated_at: new Date().toISOString() };
    if (note !== undefined) patch.notes = note;
    // Opting somebody in while an exit-reason exemption stands would do nothing
    // visible: prompt_opt_in outranks exited_at, but never wfo_exempt.
    if (optIn) patch.wfo_exempt = null;
    const { error } = await db.from("employees").update(patch).eq("email", email);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/admin/triage");
  revalidatePath("/admin/people");
}

/** Correct one day. The audit trail is `source`, which becomes 'manual'. */
export async function setAttendance(email: string, day: string, status: string) {
  const viewer = await editor();
  const { error } = await requireDb().from("attendance").upsert(
    {
      email, day, status,
      source: "manual",
      note: `Set by ${viewer.email}`,
      // `answered_at` is left alone on purpose: it means when the PERSON
      // answered, and somebody else correcting the record is not them
      // answering.
    },
    { onConflict: "email,day" },
  );
  if (error) throw new Error(error.message);
  revalidatePath("/admin/people");
  revalidatePath("/");
}

/** The site MissionHQ reports against, when Zoho's is wrong (Coimbatore). */
export async function setSiteOverride(email: string, site: string | null) {
  await editor();
  const { error } = await requireDb()
    .from("employees")
    .update({ location_override: site?.trim() || null, updated_at: new Date().toISOString() })
    .eq("email", email);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/people");
}

/** Replace a hand-kept roster. Refuses an empty list, like the SQL does. */
export async function setRoster(group: string, emails: string[]) {
  await editor();
  const clean = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (clean.length === 0) {
    throw new Error("A roster cannot be emptied: that is always a mistake, never an answer");
  }
  const { error } = await requireDb().rpc("replace_roster", { p_group: group, p_emails: clean });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/rosters");
}

/**
 * Grant or change somebody's admin access.
 *
 * Admin is the right to see 350 people's attendance, so it is deliberately not
 * self-service and deliberately recorded: `added_by` means a grant can always
 * be traced to whoever made it.
 */
export async function grantAdmin(email: string, canEdit: boolean, note?: string) {
  const viewer = await editor();
  const clean = email.trim().toLowerCase();
  if (!clean.endsWith("@hyperverge.co")) {
    throw new Error("Only HyperVerge accounts can be given admin access");
  }

  // Was this person already an admin? A level change is not news worth a DM;
  // being handed access for the first time is.
  const { data: existing } = await requireDb()
    .from("dashboard_access").select("email").eq("email", clean).maybeSingle();

  const { error } = await requireDb().from("dashboard_access").upsert(
    { email: clean, can_edit: canEdit, note: note?.trim() || null, added_by: viewer.email },
    { onConflict: "email" },
  );
  if (error) throw new Error(error.message);
  revalidatePath("/admin/access");

  // Tell them. Deliberately AFTER the write and deliberately unable to throw:
  // the grant is the real thing and a Slack outage must not undo it, or leave
  // the caller believing it failed. The reason comes back so the screen can
  // say "granted, but we could not reach them on Slack".
  if (existing) return { granted: true, notified: false, reason: "already had access" };
  return { granted: true, ...(await notifyAccessGranted(clean, canEdit, note)) };
}

/**
 * DM somebody that they have been given access.
 *
 * The dashboard URL comes from the request this action is serving, so the link
 * always points at wherever this is actually deployed rather than at a value
 * somebody has to remember to update.
 */
async function notifyAccessGranted(email: string, canEdit: boolean, note?: string) {
  const viewer = await getViewer();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return { notified: false, reason: "Supabase is not configured" };

  let dashboardUrl: string | undefined;
  try {
    const head = await headers();
    const host = head.get("x-forwarded-host") || head.get("host");
    const proto = head.get("x-forwarded-proto") || (host?.startsWith("localhost") ? "http" : "https");
    if (host) dashboardUrl = `${proto}://${host}`;
  } catch {
    // No request context. The DM simply goes without a button.
  }

  try {
    const response = await fetch(`${base}/functions/v1/mission-hq-access`, {
      method: "POST",
      headers: { authorization: `Bearer ${await invokeToken()}`, "content-type": "application/json" },
      body: JSON.stringify({
        email,
        can_edit: canEdit,
        granted_by: viewer?.email,
        note: note?.trim() || undefined,
        dashboard_url: dashboardUrl,
      }),
    });
    const result = await response.json().catch(() => ({}));
    return result?.ok
      ? { notified: true as const }
      : { notified: false as const, reason: String(result?.reason || `HTTP ${response.status}`) };
  } catch (err) {
    return { notified: false as const, reason: err instanceof Error ? err.message : "could not reach Slack" };
  }
}

/**
 * Remove somebody's admin access. They keep their own view, which comes from
 * having a company account rather than from this table.
 */
export async function revokeAdmin(email: string) {
  const viewer = await editor();
  const clean = email.trim().toLowerCase();
  // Locking yourself out leaves nobody able to let you back in except through
  // the SQL editor, which is the thing this screen exists to avoid.
  if (clean === viewer.email) throw new Error("You cannot remove your own admin access");

  // Only an EDITOR can be the last editor. The first version of this counted
  // editors and refused whenever there was one, regardless of whom it was
  // asked to remove — so with a single editor on the list, no read-only admin
  // could be taken off at all, and the error said something untrue about them.
  const { data: target } = await requireDb()
    .from("dashboard_access").select("can_edit").eq("email", clean).maybeSingle();
  if (!target) throw new Error("That person does not have admin access");

  if (target.can_edit) {
    const { count } = await requireDb()
      .from("dashboard_access")
      .select("email", { count: "exact", head: true })
      .eq("can_edit", true);
    if ((count ?? 0) <= 1) {
      throw new Error("This is the last administrator who can edit. Add another first.");
    }
  }

  const { error } = await requireDb().from("dashboard_access").delete().eq("email", clean);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/access");
}

/**
 * The token the edge functions accept.
 *
 * NOT the service-role key, and that distinction cost an outage. The functions
 * gate on `settings.edge_invoke_key` (see `_shared/auth.ts`), which is a random
 * value and deliberately not the service-role key — so presenting the latter is
 * rejected 403 like any other stranger. This file carried on sending the
 * service-role key after the gate changed, which took out all seven "Run now"
 * buttons and the access-grant DM at once.
 *
 * Read, not cached: rotating the token should take effect without a redeploy,
 * which is most of the point of keeping it in a table.
 */
async function invokeToken(): Promise<string> {
  const { data, error } = await requireDb()
    .from("settings").select("value").eq("key", "edge_invoke_key").maybeSingle();
  if (error) throw new Error(`Could not read the invoke token: ${error.message}`);
  const token = data?.value as string | undefined;
  if (!token) throw new Error("settings.edge_invoke_key is not set");
  return token;
}

/**
 * Run one of the scheduled jobs now.
 *
 * Allowlisted by NAME rather than taking a URL: this calls an authenticated
 * internal endpoint, and letting the caller choose which one is how a
 * convenience button becomes a request forwarder.
 */
const JOBS = {
  directory: "mission-hq-directory",
  leave: "mission-hq-leave",
  prompt: "mission-hq-prompt",
  verify: "mission-hq-verify",
  remind: "mission-hq-remind",
  "zoho-push": "mission-hq-zoho-push",
  summary: "mission-hq-summary",
} as const;

export async function runJob(job: keyof typeof JOBS, body: Record<string, unknown> = {}) {
  await editor();
  const fn = JOBS[job];
  if (!fn) throw new Error(`Unknown job: ${job}`);

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new Error("Supabase is not configured");

  const response = await fetch(`${base}/functions/v1/${fn}`, {
    method: "POST",
    headers: { authorization: `Bearer ${await invokeToken()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  revalidatePath("/admin");
  return { ok: response.ok, status: response.status, body: text.slice(0, 2000) };
}
