"use server";

import { revalidatePath } from "next/cache";
import { requireDb } from "@/lib/server/db";
import { attempt, requireEditor, type ActionResult } from "./shared";

/**
 * Actions on a person's own settings: the exemption, the prompt override and the
 * reported site. Each re-checks role and edit permission itself, because a server
 * action is a public endpoint with a generated name.
 */

/** Stop prompting somebody, or start again. A reason is kept, not a boolean. */
export async function setExempt(email: string, reason: string | null): Promise<ActionResult> {
  return attempt(async () => {
    const viewer = await requireEditor();
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
  });
}

/**
 * "Prompt this person anyway." The human override for the case the automatic
 * signals get wrong: a live employee whose HR record sits under a different
 * email, so the Zoho feed never lists them.
 */
export async function setPromptOptIn(email: string, optIn: boolean, note?: string): Promise<ActionResult> {
  return attempt(async () => {
    await requireEditor();
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
  });
}

/** The site MissionHQ reports against, when Zoho's is wrong (Coimbatore). */
export async function setSiteOverride(email: string, site: string | null): Promise<ActionResult> {
  return attempt(async () => {
    await requireEditor();
    const { error } = await requireDb()
      .from("employees")
      .update({ location_override: site?.trim() || null, updated_at: new Date().toISOString() })
      .eq("email", email);
    if (error) throw new Error(error.message);
    revalidatePath("/admin/people");
  });
}
