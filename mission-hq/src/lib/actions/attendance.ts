"use server";

import { revalidatePath } from "next/cache";
import { requireDb } from "@/lib/server/db";
import { getViewer } from "@/lib/server/session";
import { ActionError, attempt, istDay, type ActionResult } from "./shared";

/** An admin reading and correcting one person's record. */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** What an admin sees about one day before changing it. Any admin may look. */
export async function getAttendanceRecord(email: string, day: string): Promise<ActionResult> {
  return attempt(async () => {
    const viewer = await getViewer();
    if (!viewer) throw new Error("Not signed in");
    if (viewer.role !== "admin") throw new Error("Admins only");
    const clean = email.trim().toLowerCase();
    if (!DAY_RE.test(day)) throw new ActionError("invalid", "That is not a valid date");

    const { data, error } = await requireDb().from("attendance")
      .select("status,source,answered_at,updated_at,zoho_pushed_at,note")
      .eq("email", clean).eq("day", day).maybeSingle();
    if (error) throw new Error(error.message);
    return {
      record: {
        email: clean, day,
        status: data?.status ?? null, source: data?.source ?? null,
        answeredAt: data?.answered_at ?? null, updatedAt: data?.updated_at ?? null,
        zohoPushedAt: data?.zoho_pushed_at ?? null, note: data?.note ?? null,
      },
    };
  });
}

/**
 * Correct one person's record for one day, any past day.
 *
 * The member's own rules (60 days, only an unanswered day) do NOT apply here:
 * an admin editor can fix what a member can no longer touch. What does apply:
 *
 *   - role AND edit permission, re-checked here. The screen hiding a button is
 *     not the control.
 *   - a REASON, required and kept, with who and when, in the append-only
 *     `attendance_events`. The row itself keeps only the latest note.
 *   - A VERSION CHECK. The caller sends the `updated_at` it was looking at; if
 *     the row has moved, nothing is written and the caller is told it conflicts.
 *     A silent overwrite of somebody else's correction is the failure this
 *     exists to prevent.
 *   - the member's `answered_at` is left alone: when THEY answered and when an
 *     admin changed it are different facts.
 *
 * It does not push to Zoho or touch Slack. Saved here does not mean synced, and
 * the screen says so: a correction within 60 days is swept to Zoho at 19:30,
 * and an older one is outside that window and is not sent at all.
 */
export async function correctAttendance(input: {
  email: string; day: string; status: string; reason: string; expectedUpdatedAt: string | null;
}): Promise<ActionResult> {
  return attempt(async () => {
    const viewer = await getViewer();
    if (!viewer) throw new Error("Not signed in");
    if (viewer.role !== "admin") throw new Error("Admins only");
    if (!viewer.canEdit) throw new ActionError("view-only", "You have view-only access. An admin editor is needed to make a correction.");

    const email = input.email.trim().toLowerCase();
    const reason = input.reason.trim();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new ActionError("invalid", "Choose a member");
    if (!DAY_RE.test(input.day)) throw new ActionError("invalid", "Choose a date");
    if (input.day > istDay()) throw new ActionError("invalid", "A correction cannot be for a future date");
    const dow = new Date(`${input.day}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) throw new ActionError("invalid", "That date is a weekend; nobody is asked on weekends");
    if (reason.length < 3) throw new ActionError("invalid", "Add a reason for the correction");
    if (reason.length > 500) throw new ActionError("invalid", "Keep the reason under 500 characters");

    const db = requireDb();
    const [{ data: location }, { data: current, error: readError }, { data: employee }] = await Promise.all([
      db.from("locations").select("status").eq("status", input.status).eq("active", true).limit(1).maybeSingle(),
      db.from("attendance").select("status,updated_at").eq("email", email).eq("day", input.day).maybeSingle(),
      db.from("employees").select("email").eq("email", email).maybeSingle(),
    ]);
    if (readError) throw new Error(readError.message);
    if (!employee) throw new ActionError("invalid", "There is no employee record for that member");
    if (!location) throw new ActionError("invalid", "Choose one of the listed work locations");

    // Compared as instants, not strings: the same moment can be written two ways.
    const had = current?.updated_at ? new Date(current.updated_at).getTime() : null;
    const saw = input.expectedUpdatedAt ? new Date(input.expectedUpdatedAt).getTime() : null;
    if (had !== saw) throw new ActionError("conflict", "This record changed while you were editing. Your correction has not been saved.");
    if (current?.status === input.status) throw new ActionError("invalid", "That day is already recorded as that status");

    const now = new Date().toISOString();
    const { error } = await db.from("attendance").upsert(
      { email, day: input.day, status: input.status, source: "manual", note: `Corrected by ${viewer.email}: ${reason}`, updated_at: now },
      { onConflict: "email,day" },
    );
    if (error) throw new Error(error.message);

    // After the write, and unable to undo it: the correction is real. If only the
    // history row fails, say so rather than pretend the audit trail is whole.
    const { error: eventError } = await db.from("attendance_events").insert({
      email, day: input.day, old_status: current?.status ?? null, new_status: input.status, reason, actor: viewer.email,
    });
    if (eventError) console.error("correctAttendance: history not recorded:", eventError.message);

    revalidatePath("/");
    return {
      updatedAt: now, by: viewer.email, previous: current?.status ?? null,
      historyRecorded: !eventError,
      // Whether the 19:30 run can still pick this day up (migration 24's window).
      withinZohoWindow: input.day >= istDay(-60),
    };
  });
}
