"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireDb } from "@/lib/server/db";
import { attempt, invokeToken, requireAccessManager, type ActionResult } from "./shared";

/** Who may see everybody's attendance, and who may change it. */

/**
 * The last-editor rule, shared by a level change and a removal. Demoting or
 * removing the only editor leaves nobody able to correct a record.
 */
async function refuseIfLastEditor(message: string) {
  const { count, error } = await requireDb()
    .from("dashboard_access")
    .select("email", { count: "exact", head: true })
    .eq("can_edit", true);
  if (error) throw new Error(error.message);
  if ((count ?? 0) <= 1) throw new Error(message);
}

/**
 * Who may change the EDITOR level, in either direction: editors only.
 *
 * A workspace admin manages who can see the dashboard, not who can rewrite
 * records. Without this a viewer-level workspace admin could make themselves an
 * editor, or take editing away from the people who do it, which is exactly the
 * power the role exists to withhold.
 */
function refuseEditorChangeUnlessEditor(viewer: { canEdit: boolean }) {
  if (!viewer.canEdit) {
    throw new Error("Only an editor can give or take away editing. Workspace admins manage viewer access.");
  }
}

/**
 * Give somebody admin access for the first time.
 *
 * Admin is the right to see 350 people's attendance, so it is deliberately not
 * self-service and deliberately recorded: `added_by` means a grant can always
 * be traced to whoever made it.
 *
 * `manageAccess` makes them a workspace admin: they may add and remove viewers
 * and choose other workspace admins. Editing stays with editors.
 *
 * NEW ADMINS ONLY. An existing admin is refused rather than overwritten: the
 * grant form's defaults would otherwise silently reset their level, workspace
 * role, note and grantor. Changes go through `updateAdmin`.
 */
export async function grantAdmin(
  email: string, canEdit: boolean, note?: string, manageAccess = false,
): Promise<ActionResult> {
  return attempt(async () => {
    const viewer = await requireAccessManager();
    const clean = email.trim().toLowerCase();
    if (!clean.endsWith("@hyperverge.co")) {
      throw new Error("Only HyperVerge accounts can be given admin access");
    }
    if (canEdit) refuseEditorChangeUnlessEditor(viewer);

    // A failed lookup must not read as "new": that would overwrite an admin
    // and DM somebody who already had access. Unknown means stop.
    const { data: existing, error: lookupError } = await requireDb()
      .from("dashboard_access").select("email").eq("email", clean).maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (existing) throw new Error("Already an admin. Use Manage access on their card to change it.");

    const { error } = await requireDb().from("dashboard_access").insert({
      email: clean, can_edit: canEdit, can_manage_access: manageAccess,
      note: note?.trim() || null, added_by: viewer.email,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/admin/access");

    // Tell them. Deliberately AFTER the write and deliberately unable to throw:
    // the grant is the real thing and a Slack outage must not undo it, or leave
    // the caller believing it failed. The reason comes back so the screen can
    // say "granted, but we could not reach them on Slack".
    return { granted: true, ...(await notifyAccessGranted(clean, canEdit, manageAccess, viewer.email, note)) };
  });
}

/**
 * Change an existing admin's level or workspace role. Sends no Slack message:
 * a change is not news worth a DM, being handed access for the first time is.
 *
 * Only the two permission columns are written. `note` and `added_by` describe
 * the original grant and are left as they were.
 */
export async function updateAdmin(email: string, canEdit: boolean, manageAccess: boolean): Promise<ActionResult> {
  return attempt(async () => {
    const viewer = await requireAccessManager();
    const clean = email.trim().toLowerCase();
    // Same reasoning as refusing to remove yourself: nobody could undo it
    // except through the SQL editor.
    if (clean === viewer.email && !canEdit && !manageAccess) {
      throw new Error("You cannot remove your own ability to manage access");
    }

    const { data: target, error: lookupError } = await requireDb()
      .from("dashboard_access").select("can_edit").eq("email", clean).maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!target) throw new Error("That person does not have admin access");

    if (target.can_edit !== canEdit) refuseEditorChangeUnlessEditor(viewer);
    if (target.can_edit && !canEdit) {
      await refuseIfLastEditor("This is the last administrator who can edit. Make somebody else an editor first.");
    }

    // `.select()` returns the changed rows, so a row removed since the lookup
    // reads as a failure instead of "Permission level updated".
    const { data: changed, error } = await requireDb().from("dashboard_access")
      .update({ can_edit: canEdit, can_manage_access: manageAccess })
      .eq("email", clean)
      .select("email");
    if (error) throw new Error(error.message);
    if (!changed?.length) throw new Error("That person no longer has admin access");
    revalidatePath("/admin/access");
  });
}

/**
 * DM somebody that they have been given access.
 *
 * The dashboard URL comes from the request this action is serving, so the link
 * always points at wherever this is actually deployed rather than at a value
 * somebody has to remember to update.
 */
async function notifyAccessGranted(email: string, canEdit: boolean, manageAccess: boolean, grantedBy: string, note?: string) {
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
        can_manage_access: manageAccess,
        granted_by: grantedBy,
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
export async function revokeAdmin(email: string): Promise<ActionResult> {
  return attempt(async () => {
    const viewer = await requireAccessManager();
    const clean = email.trim().toLowerCase();
    // Locking yourself out leaves nobody able to let you back in except through
    // the SQL editor, which is the thing this screen exists to avoid.
    if (clean === viewer.email) throw new Error("You cannot remove your own admin access");

    // Only an EDITOR can be the last editor. The first version of this counted
    // editors and refused whenever there was one, regardless of whom it was
    // asked to remove — so with a single editor on the list, no read-only admin
    // could be taken off at all, and the error said something untrue about them.
    const { data: target, error: lookupError } = await requireDb()
      .from("dashboard_access").select("can_edit").eq("email", clean).maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!target) throw new Error("That person does not have admin access");

    if (target.can_edit) {
      // Removing an editor takes editing away, which stays with editors.
      refuseEditorChangeUnlessEditor(viewer);
      await refuseIfLastEditor("This is the last administrator who can edit. Add another first.");
    }

    const { error } = await requireDb().from("dashboard_access").delete().eq("email", clean);
    if (error) throw new Error(error.message);
    revalidatePath("/admin/access");
  });
}
